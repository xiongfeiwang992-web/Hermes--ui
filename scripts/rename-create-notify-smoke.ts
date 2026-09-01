import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "rename-create-notify-smoke.db")).dbPath
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
const createMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "deal_rename" && m.title === "成交更名草稿已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const house = app.call(
  "house.create",
  {
    title: "更名登记通知房",
    deal_type: "sale",
    community: "更名通知苑",
    price: 260,
    owner_name: "更名业主",
    owner_phone: "13771001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "更名客户", phone: "13871001111", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 240,
    commission_owner: 6000,
    commission_customer: 6000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve deal");

const beforeAdmin = createMsgs(admin).length;
const beforeManager = createMsgs(manager).length;
const beforeAgent = createMsgs(agent).length;
const rename = app.call(
  "dealExt.renames.create",
  {
    deal_id: dealId,
    target: "customer",
    new_customer_name: "更名新客户",
    reason: "网签姓名更正通知",
  },
  agent
);
assert(rename.ok, "agent creates rename draft");
const renameId = data<any>(rename).id;
assert(createMsgs(admin).length === beforeAdmin + 1, "admin receives rename draft message");
assert(createMsgs(manager).length === beforeManager + 1, "manager receives rename draft message");
assert(createMsgs(agent).length === beforeAgent, "creator does not self-notify");
assert(
  createMsgs(manager).some(
    (m) => m.ref_id === renameId && String(m.body).includes("网签姓名更正通知")
  ),
  "rename draft message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { deal_ext: false } }, manager).ok,
  "mute deal_ext"
);
const house2 = app.call(
  "house.create",
  {
    title: "静音更名房",
    deal_type: "sale",
    community: "静音更名苑",
    price: 200,
    owner_name: "静音业主",
    owner_phone: "13771002222",
    status: "available",
  },
  agent
);
const customer2 = app.call(
  "customer.create",
  { name: "静音更名客", phone: "13871002222", intent: "buy" },
  agent
);
const deal2 = app.call(
  "deal.create",
  {
    house_id: data<any>(house2).id,
    customer_id: data<any>(customer2).id,
    contract_price: 180,
    commission_owner: 4000,
    commission_customer: 4000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal2.ok, "create second deal");
assert(app.call("deal.submit", { id: data<any>(deal2).id }, agent).ok, "submit second deal");
assert(app.call("deal.approve", { id: data<any>(deal2).id }, manager).ok, "approve second deal");
const beforeMute = createMsgs(manager).length;
const beforeMuteAdmin = createMsgs(admin).length;
assert(
  app.call(
    "dealExt.renames.create",
    {
      deal_id: data<any>(deal2).id,
      target: "customer",
      new_customer_name: "静音新客户",
      reason: "静音更名草稿",
    },
    agent
  ).ok,
  "create while muted"
);
assert(createMsgs(manager).length === beforeMute, "muted deal_ext suppresses message");
assert(createMsgs(admin).length === beforeMuteAdmin + 1, "admin still receives when manager muted");

console.log(`Rename create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
