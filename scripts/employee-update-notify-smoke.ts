import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "employee-update-notify-smoke.db")).dbPath
);

let passed = 0;
let failed = 0;
const assert = (value: unknown, name: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string, password = "123456") => {
  const result = app.call("auth.login", { account, password });
  assert(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const updateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "员工资料已更新"
  );

const admin = login("admin");
const manager = login("manager");
const storeId = data<any>(app.call("auth.me", {}, manager)).store_id;

const created = app.call(
  "org.users.upsert",
  {
    account: "upd_agent_x",
    display_name: "待更新员工",
    role: "agent",
    store_id: storeId,
    password: "12345678",
  },
  admin
);
assert(created.ok, "admin creates employee");
const userId = data<any>(created).id;
const employee = login("upd_agent_x", "12345678");

assert(
  !app.call(
    "org.users.upsert",
    {
      id: userId,
      account: "upd_agent_x",
      display_name: "店长不可改",
      role: "agent",
      store_id: storeId,
    },
    manager
  ).ok,
  "manager cannot update employee"
);

const beforeEmp = updateMsgs(employee).length;
const beforeAdmin = updateMsgs(admin).length;
const updated = app.call(
  "org.users.upsert",
  {
    id: userId,
    account: "upd_agent_x",
    display_name: "已更新员工",
    role: "agent",
    store_id: storeId,
    phone: "13722002222",
  },
  admin
);
assert(updated.ok, "admin updates employee");
assert(updateMsgs(employee).length === beforeEmp + 1, "employee receives update message");
assert(updateMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(
  updateMsgs(employee).some(
    (m) =>
      m.ref_id === userId &&
      String(m.body).includes("已更新员工") &&
      String(m.body).includes("upd_agent_x") &&
      !String(m.body).includes("密码已重置")
  ),
  "update message body without password note"
);

const beforePwd = updateMsgs(employee).length;
assert(
  app.call(
    "org.users.upsert",
    {
      id: userId,
      account: "upd_agent_x",
      display_name: "已更新员工",
      role: "agent",
      store_id: storeId,
      password: "87654321",
    },
    admin
  ).ok,
  "admin resets password"
);
assert(updateMsgs(employee).length === beforePwd + 1, "password reset notifies employee");
assert(
  updateMsgs(employee).some((m) => String(m.body).includes("密码已重置")),
  "password reset note in body"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, employee).ok,
  "mute other"
);
const beforeMute = updateMsgs(employee).length;
assert(
  app.call(
    "org.users.upsert",
    {
      id: userId,
      account: "upd_agent_x",
      display_name: "静音更新员工",
      role: "agent",
      store_id: storeId,
    },
    admin
  ).ok,
  "update while muted"
);
assert(updateMsgs(employee).length === beforeMute, "muted other suppresses update message");

console.log(`Employee update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
