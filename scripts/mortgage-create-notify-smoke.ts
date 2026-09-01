import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "mortgage-create-notify-smoke.db")).dbPath
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
    (m) => m.kind === "mortgage_status" && m.title === "按揭记录已登记"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

const house = app.call(
  "house.create",
  {
    title: "按揭登记通知房",
    deal_type: "sale",
    community: "按揭通知苑",
    price: 300,
    owner_name: "按揭业主",
    owner_phone: "13770001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "按揭登记客", phone: "13870001111", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 280,
    commission_owner: 8000,
    commission_customer: 8000,
    agent_ids: [agentId, peerId],
    split_ratios: { [agentId]: 50, [peerId]: 50 },
  },
  agent
);
assert(deal.ok, "create deal without loan");
const dealId = data<any>(deal).id;
const existing = app.call("mortgage.get", { deal_id: dealId }, agent);
assert(existing.ok && data<any>(existing) == null, "no auto mortgage without loan fields");

const beforeAgent = createMsgs(agent).length;
const beforePeer = createMsgs(peer).length;
const beforeManager = createMsgs(manager).length;
const created = app.call(
  "mortgage.upsert",
  { deal_id: dealId, bank: "通知测试银行", amount: 160, remark: "首套" },
  manager
);
assert(created.ok, "manager creates mortgage");
assert(createMsgs(agent).length === beforeAgent + 1, "deal agent receives create message");
assert(createMsgs(peer).length === beforePeer + 1, "peer agent receives create message");
assert(createMsgs(manager).length === beforeManager, "creator does not self-notify");
assert(
  createMsgs(agent).some(
    (m) =>
      m.ref_id === dealId &&
      String(m.body).includes("通知测试银行") &&
      String(m.body).includes("160")
  ),
  "create message body"
);

const beforeUpdate = createMsgs(agent).length;
assert(
  app.call(
    "mortgage.upsert",
    { deal_id: dealId, bank: "通知测试银行", amount: 155, remark: "调整" },
    manager
  ).ok,
  "manager updates mortgage"
);
assert(createMsgs(agent).length === beforeUpdate, "update does not re-notify");

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agent).ok,
  "mute house"
);
const house2 = app.call(
  "house.create",
  {
    title: "静音按揭房",
    deal_type: "sale",
    community: "静音按揭苑",
    price: 220,
    owner_name: "静音业主",
    owner_phone: "13770002222",
    status: "available",
  },
  agent
);
const customer2 = app.call(
  "customer.create",
  { name: "静音按揭客", phone: "13870002222", intent: "buy" },
  agent
);
const deal2 = app.call(
  "deal.create",
  {
    house_id: data<any>(house2).id,
    customer_id: data<any>(customer2).id,
    contract_price: 200,
    commission_owner: 5000,
    commission_customer: 5000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  peer
);
assert(deal2.ok, "peer creates second deal");
const beforeMute = createMsgs(agent).length;
const beforeMutePeer = createMsgs(peer).length;
assert(
  app.call(
    "mortgage.upsert",
    { deal_id: data<any>(deal2).id, bank: "静音银行", amount: 100 },
    manager
  ).ok,
  "create while muted"
);
assert(createMsgs(agent).length === beforeMute, "muted house suppresses message");
assert(createMsgs(peer).length === beforeMutePeer + 1, "peer still receives when agent muted");

console.log(`Mortgage create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
