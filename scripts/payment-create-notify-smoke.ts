import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "payment-create-notify-smoke.db")).dbPath
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
const pendingMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "payment" && m.title === "佣金收款待确认"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const finance = login("finance");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

const house = app.call(
  "house.create",
  {
    title: "收款登记通知房源",
    deal_type: "sale",
    community: "待确认苑",
    price: 300,
    owner_name: "待确认业主",
    owner_phone: "13691001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "待确认客户", phone: "13691002222", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 300,
    commission_owner: 20000,
    commission_customer: 10000,
    agent_ids: [agentId, peerId],
    split_ratios: { [agentId]: 60, [peerId]: 40 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve deal");

const beforeAgent = pendingMsgs(agent).length;
const beforePeer = pendingMsgs(peer).length;
const beforeFinance = pendingMsgs(finance).length;
const pay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 10000, method: "transfer", payer_side: "customer" },
  finance
);
assert(pay.ok, "finance registers payment");
assert(data<any>(pay).status === "pending", "status pending");
const paymentId = data<any>(pay).id;
assert(pendingMsgs(agent).length === beforeAgent + 1, "agent receives pending message");
assert(pendingMsgs(peer).length === beforePeer + 1, "peer receives pending message");
assert(pendingMsgs(finance).length === beforeFinance, "finance actor does not self-notify");
assert(
  pendingMsgs(agent).some(
    (m) =>
      m.ref_id === paymentId &&
      String(m.body).includes(dealId) &&
      String(m.body).includes("10000") &&
      String(m.body).includes("待出纳确认")
  ),
  "pending message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { payment: false } }, peer).ok,
  "mute payment"
);
const beforeMute = pendingMsgs(peer).length;
assert(
  app.call(
    "payment.create",
    { deal_id: dealId, amount: 2000, method: "cash", payer_side: "owner" },
    finance
  ).ok,
  "second payment while muted"
);
assert(pendingMsgs(peer).length === beforeMute, "muted payment suppresses pending message");
assert(
  pendingMsgs(agent).some((m) => String(m.body).includes("2000")),
  "unmuted agent still notified"
);

console.log(`Payment create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
