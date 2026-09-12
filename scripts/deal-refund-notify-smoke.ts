import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "deal-refund-notify-smoke.db")).dbPath
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
const refundMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "payment" && m.title === "成交已退款"
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
    title: "退款通知房源",
    deal_type: "sale",
    community: "退款苑",
    price: 280,
    owner_name: "退款业主",
    owner_phone: "13670001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "退款客户", phone: "13670002222", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 280,
    commission_owner: 15000,
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

const pay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 10000, method: "transfer", payer_side: "customer" },
  finance
);
assert(pay.ok, "register payment");
assert(app.call("payment.confirm", { id: data<any>(pay).id }, finance).ok, "confirm payment");

const beforeAgent = refundMsgs(agent).length;
const beforePeer = refundMsgs(peer).length;
const beforeFinance = refundMsgs(finance).length;
assert(
  !app.call(
    "payment.refund",
    { deal_id: dealId, amount: 1000, reason: "" },
    finance
  ).ok,
  "refund requires reason"
);
const refunded = app.call(
  "payment.refund",
  {
    deal_id: dealId,
    amount: 2000,
    reason: "佣金调整退回",
    method: "transfer",
  },
  finance
);
assert(refunded.ok, "finance refunds");
const refundId = data<any>(refunded).id;
assert(refundMsgs(agent).length === beforeAgent + 1, "agent receives refund message");
assert(refundMsgs(peer).length === beforePeer + 1, "peer agent receives refund message");
assert(refundMsgs(finance).length === beforeFinance, "finance actor does not self-notify");
assert(
  refundMsgs(agent).some(
    (m) =>
      m.ref_id === refundId &&
      String(m.body).includes(dealId) &&
      String(m.body).includes("2000") &&
      String(m.body).includes("佣金调整退回")
  ),
  "refund message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { payment: false } }, peer).ok,
  "mute payment channel"
);
const beforeMute = refundMsgs(peer).length;
assert(
  app.call(
    "payment.refund",
    {
      deal_id: dealId,
      amount: 500,
      reason: "静音退款",
      method: "transfer",
    },
    finance
  ).ok,
  "second refund while muted"
);
assert(refundMsgs(peer).length === beforeMute, "muted payment suppresses refund message");
assert(
  refundMsgs(agent).some((m) => String(m.body).includes("静音退款")),
  "unmuted agent still notified"
);

console.log(`Deal refund notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
