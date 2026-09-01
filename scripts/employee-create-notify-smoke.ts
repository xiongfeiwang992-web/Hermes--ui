import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "employee-create-notify-smoke.db")).dbPath
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
const acctMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "employee_account" &&
      (m.title === "账号已开通" || m.title === "新员工账号已创建")
  );

const admin = login("admin");
const manager = login("manager");
const storeId = data<any>(app.call("auth.me", {}, manager)).store_id;

assert(
  !app.call(
    "org.users.upsert",
    {
      account: "blocked_mgr",
      display_name: "店长不可建",
      role: "agent",
      store_id: storeId,
      password: "12345678",
    },
    manager
  ).ok,
  "manager cannot create employee"
);

const beforeAdmin = acctMsgs(admin).length;
const beforeManager = acctMsgs(manager).length;
const created = app.call(
  "org.users.upsert",
  {
    account: "notify_agent_x",
    display_name: "通知新员工",
    role: "agent",
    store_id: storeId,
    password: "12345678",
    phone: "13722001111",
  },
  admin
);
assert(created.ok, "admin creates employee");
const userId = data<any>(created).id;

const newEmp = login("notify_agent_x", "12345678");
assert(
  acctMsgs(newEmp).some(
    (m) =>
      m.ref_id === userId &&
      m.title === "账号已开通" &&
      String(m.body).includes("通知新员工") &&
      String(m.body).includes("notify_agent_x")
  ),
  "new employee receives welcome message"
);
assert(acctMsgs(admin).length === beforeAdmin, "admin creator does not self-notify");
assert(acctMsgs(manager).length === beforeManager + 1, "manager receives create message");
assert(
  acctMsgs(manager).some(
    (m) => m.ref_id === userId && m.title === "新员工账号已创建"
  ),
  "manager message title"
);

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, manager).ok,
  "mute hr"
);
const beforeMute = acctMsgs(manager).length;
assert(
  app.call(
    "org.users.upsert",
    {
      account: "notify_agent_z",
      display_name: "静音员工",
      role: "agent",
      store_id: storeId,
      password: "12345678",
    },
    admin
  ).ok,
  "create while muted"
);
assert(acctMsgs(manager).length === beforeMute, "muted hr suppresses manager message");
const mutedEmp = login("notify_agent_z", "12345678");
assert(
  acctMsgs(mutedEmp).some((m) => m.title === "账号已开通"),
  "new employee still receives welcome when manager muted"
);

console.log(`Employee create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
