import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "deal-create-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "成交草稿已登记"
  );

const agentA = login("agent_a");
const agentB = login("agent_b");
const manager = login("manager");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

let phoneSeq = 1000;
function createHouse(token: string, title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "成交创建小区",
      price: 200,
      owner_name: "成交业主",
      owner_phone: `1333${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    token
  );
  assert(house.ok, `create house ${title}`);
  return data<any>(house).id;
}
function createCustomer(token: string, name: string) {
  phoneSeq += 1;
  const customer = app.call(
    "customer.create",
    {
      name,
      phone: `1322${String(phoneSeq).padStart(7, "0")}`,
      intent: "buy",
      budget_min: 100,
      budget_max: 300,
    },
    token
  );
  assert(customer.ok, `create customer ${name}`);
  return data<any>(customer).id;
}

const peerHouse = createHouse(agentB, "成交创建通知盘");
const myCustomer = createCustomer(agentA, "成交创建客户");
const beforeB = createMsgs(agentB).length;
const beforeA = createMsgs(agentA).length;
const beforeM = createMsgs(manager).length;
const deal = app.call(
  "deal.create",
  {
    house_id: peerHouse,
    customer_id: myCustomer,
    contract_price: 195,
    commission_owner: 10000,
    commission_customer: 10000,
    agent_ids: [agentAId, agentBId],
    split_ratios: { [agentAId]: 60, [agentBId]: 40 },
  },
  agentA
);
assert(deal.ok, "agent creates deal draft");
const dealId = data<any>(deal).id;
assert(createMsgs(agentB).length === beforeB + 1, "house/co-agent receives create message");
assert(createMsgs(agentA).length === beforeA, "creator does not self-notify");
assert(createMsgs(manager).length === beforeM, "manager not notified on draft create");
assert(
  createMsgs(agentB).some(
    (m) =>
      m.ref_id === dealId &&
      String(m.body).includes(dealId) &&
      String(m.body).includes("195")
  ),
  "create message body"
);

const selfHouse = createHouse(agentA, "自盘自客成交");
const selfCustomer = createCustomer(agentA, "自客成交");
const beforeSelf = createMsgs(agentA).length;
assert(
  app.call(
    "deal.create",
    {
      house_id: selfHouse,
      customer_id: selfCustomer,
      contract_price: 180,
      commission_owner: 8000,
      commission_customer: 8000,
      agent_ids: [agentAId],
      split_ratios: { [agentAId]: 100 },
    },
    agentA
  ).ok,
  "create self deal"
);
assert(createMsgs(agentA).length === beforeSelf, "self deal skips all recipients");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agentB).ok,
  "mute other"
);
const muteHouse = createHouse(agentB, "静音成交盘");
const muteCustomer = createCustomer(agentA, "静音成交客");
const beforeMute = createMsgs(agentB).length;
assert(
  app.call(
    "deal.create",
    {
      house_id: muteHouse,
      customer_id: muteCustomer,
      contract_price: 170,
      commission_owner: 7000,
      commission_customer: 7000,
      agent_ids: [agentAId],
      split_ratios: { [agentAId]: 100 },
    },
    agentA
  ).ok,
  "create while muted"
);
assert(createMsgs(agentB).length === beforeMute, "muted other suppresses create message");

console.log(`Deal create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
