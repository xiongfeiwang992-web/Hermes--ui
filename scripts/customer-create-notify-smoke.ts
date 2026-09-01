import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "customer-create-notify-smoke.db")).dbPath
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
const custMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "customer_create" && m.title === "新客源已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

const beforeAdmin = custMsgs(admin).length;
const beforeManager = custMsgs(manager).length;
const beforeAgent = custMsgs(agent).length;
const created = app.call(
  "customer.create",
  {
    name: "登记通知客",
    phone: "13966001111",
    intent: "buy",
    need: "三房刚需客源",
  },
  agent
);
assert(created.ok, "agent creates customer");
const customerId = data<any>(created).id;
assert(custMsgs(admin).length === beforeAdmin + 1, "admin receives create message");
assert(custMsgs(manager).length === beforeManager + 1, "manager receives create message");
assert(custMsgs(agent).length === beforeAgent, "creator does not self-notify");
assert(
  custMsgs(manager).some(
    (m) =>
      m.ref_id === customerId &&
      String(m.body).includes("登记通知客") &&
      String(m.body).includes(agentName)
  ),
  "create message body"
);

const beforeSelfMgr = custMsgs(manager).length;
const beforeSelfAdmin = custMsgs(admin).length;
const mgrCust = app.call(
  "customer.create",
  {
    name: "店长自登记客",
    phone: "13966002222",
    intent: "rent",
    need: "两房租客",
  },
  manager
);
assert(mgrCust.ok, "manager creates customer");
assert(custMsgs(manager).length === beforeSelfMgr, "manager actor skips self");
assert(custMsgs(admin).length === beforeSelfAdmin + 1, "admin notified for manager create");

assert(
  app.call("message.subscriptions.save", { channels: { customer: false } }, admin).ok,
  "mute customer"
);
const beforeMute = custMsgs(admin).length;
const beforeMuteMgr = custMsgs(manager).length;
const muted = app.call(
  "customer.create",
  {
    name: "静音登记客",
    phone: "13966003333",
    intent: "buy",
    need: "静音测试客源",
  },
  agent
);
assert(muted.ok, "create while muted");
assert(custMsgs(admin).length === beforeMute, "muted customer suppresses message");
assert(
  custMsgs(manager).length === beforeMuteMgr + 1,
  "manager still receives when admin muted"
);

console.log(`Customer create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
