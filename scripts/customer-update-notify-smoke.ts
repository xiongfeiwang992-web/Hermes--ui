import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "customer-update-notify-smoke.db")).dbPath
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
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  assert(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const updateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "customer_update" && m.title === "客源信息已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

const created = app.call(
  "customer.create",
  {
    name: "更新通知客原稿",
    phone: "13977001111",
    intent: "buy",
    need: "三房刚需",
  },
  agent
);
assert(created.ok, "agent creates customer for update");
const customerId = data<any>(created).id;

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "customer.update",
  {
    id: customerId,
    name: "更新通知客改稿",
    need: "四房改善",
  },
  agent
);
assert(updated.ok, "agent updates customer");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives update message");
assert(updateMsgs(manager).length === beforeManager + 1, "manager receives update message");
assert(updateMsgs(agent).length === beforeAgent, "updater does not self-notify");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === customerId &&
      m.ref_type === "customer" &&
      String(m.body).includes("更新通知客改稿") &&
      String(m.body).includes(agentName)
  ),
  "update message body"
);

const beforeSelfMgr = updateMsgs(manager).length;
const beforeSelfAdmin = updateMsgs(admin).length;
assert(
  app.call(
    "customer.update",
    { id: customerId, remark: "店长备注" },
    manager
  ).ok,
  "manager updates customer"
);
assert(updateMsgs(manager).length === beforeSelfMgr, "manager actor skips self");
assert(updateMsgs(admin).length === beforeSelfAdmin + 1, "admin notified for manager update");

assert(
  app.call("message.subscriptions.save", { channels: { customer: false } }, admin).ok,
  "mute customer"
);
const beforeMute = updateMsgs(admin).length;
const beforeMuteMgr = updateMsgs(manager).length;
assert(
  app.call(
    "customer.update",
    { id: customerId, name: "静音更新客" },
    agent
  ).ok,
  "update while muted"
);
assert(updateMsgs(admin).length === beforeMute, "muted customer suppresses message");
assert(
  updateMsgs(manager).length === beforeMuteMgr + 1,
  "manager still receives when admin muted"
);

console.log(`Customer update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
