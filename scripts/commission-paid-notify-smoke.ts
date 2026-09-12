import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "commission-paid-notify-smoke.db")).dbPath
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
const paidMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "commission_paid" && m.title === "提成已发放"
  );

const agent = login("agent_a");
const peer = login("agent_b");
const manager = login("manager");
const finance = login("finance");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

const house = app.call(
  "house.create",
  {
    title: "提成通知盘",
    deal_type: "sale",
    community: "提成苑",
    price: 200,
    owner_name: "提成业主",
    owner_phone: "13680014001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "提成通知客", phone: "13680014002", intent: "buy", need: "提成测试客" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 200,
    commission_owner: 12000,
    commission_customer: 8000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve deal");

const listed = data<any[]>(app.call("commission.list", {}, finance)).filter(
  (row) => row.deal_id === dealId && row.user_id === agentId
);
assert(listed.length === 1 && listed[0].status === "accrued", "commission accrued");
const commissionId = listed[0].id;

const beforeAgent = paidMsgs(agent).length;
const beforeFinance = paidMsgs(finance).length;
const paid = app.call("commission.paid", { id: commissionId }, finance);
assert(paid.ok && data<any>(paid).status === "paid", "finance marks paid");
assert(paidMsgs(agent).length === beforeAgent + 1, "agent receives paid message");
assert(paidMsgs(finance).length === beforeFinance, "finance actor does not self-notify");
assert(
  paidMsgs(agent).some(
    (m) =>
      m.ref_id === commissionId &&
      String(m.body).includes(dealId) &&
      String(m.body).includes(String(listed[0].amount))
  ),
  "paid message body"
);
assert(!app.call("commission.paid", { id: commissionId }, finance).ok, "cannot pay twice");

// second deal for mute + peer agent
const house2 = app.call(
  "house.create",
  {
    title: "提成静音盘",
    deal_type: "sale",
    community: "提成苑",
    price: 180,
    owner_name: "静音业主",
    owner_phone: "13680014003",
    status: "available",
  },
  peer
);
assert(house2.ok, "create peer house");
const customer2 = app.call(
  "customer.create",
  { name: "提成静音客", phone: "13680014004", intent: "buy", need: "静音提成客" },
  peer
);
assert(customer2.ok, "create peer customer");
const deal2 = app.call(
  "deal.create",
  {
    house_id: data<any>(house2).id,
    customer_id: data<any>(customer2).id,
    contract_price: 180,
    commission_owner: 9000,
    commission_customer: 6000,
    agent_ids: [peerId],
    split_ratios: { [peerId]: 100 },
  },
  peer
);
assert(deal2.ok, "create peer deal");
assert(app.call("deal.submit", { id: data<any>(deal2).id }, peer).ok, "submit peer deal");
assert(app.call("deal.approve", { id: data<any>(deal2).id }, manager).ok, "approve peer deal");
const peerCommission = data<any[]>(app.call("commission.list", {}, finance)).find(
  (row) => row.deal_id === data<any>(deal2).id && row.user_id === peerId
);
assert(Boolean(peerCommission), "peer commission exists");

assert(
  app.call("message.subscriptions.save", { channels: { payment: false } }, peer).ok,
  "mute payment"
);
const beforeMute = paidMsgs(peer).length;
assert(
  app.call("commission.paid", { id: peerCommission.id }, finance).ok,
  "pay while muted"
);
assert(paidMsgs(peer).length === beforeMute, "muted payment suppresses message");

console.log(`Commission paid notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
