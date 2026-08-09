import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "deal-amounts-smoke.db")).dbPath);
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

const agent = login("agent_a");
const manager = login("manager");
const finance = login("finance");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const house = app.call(
  "house.create",
  {
    title: "收付明细盘",
    deal_type: "sale",
    community: "收付苑",
    price: 310,
    owner_name: "业主",
    owner_phone: "13680008001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "收付客", phone: "13680008002", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");

const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 310,
    commission_owner: 20000,
    commission_customer: 10000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve");

const initial = data<any>(app.call("deal.get", { id: dealId }, agent));
assert(initial.receivable_amount === 30000, "receivable = commission total");
assert(initial.paid_amount === 0, "paid starts 0");
assert(initial.unpaid_amount === 30000, "unpaid equals receivable");
assert(initial.pending_amount === 0, "no pending yet");
assert(Array.isArray(initial.payments) && initial.payments.length === 0, "payments empty");

const listed = data<any[]>(app.call("deal.list", {}, manager)).find((row) => row.id === dealId);
assert(
  listed &&
    listed.receivable_amount === 30000 &&
    listed.paid_amount === 0 &&
    listed.unpaid_amount === 30000,
  "list exposes amount triad"
);

const pendingPay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 12000, method: "transfer", payer_side: "customer" },
  finance
);
assert(pendingPay.ok, "register pending payment");
const paymentId = data<any>(pendingPay).id;

const afterPending = data<any>(app.call("deal.get", { id: dealId }, finance));
assert(afterPending.paid_amount === 0, "pending not counted as paid");
assert(afterPending.pending_amount === 12000, "pending_amount tracked");
assert(afterPending.unpaid_amount === 30000, "unpaid unchanged while pending");
assert(
  afterPending.payments.length === 1 && afterPending.payments[0].status === "pending",
  "payments include pending"
);

assert(app.call("payment.confirm", { id: paymentId }, finance).ok, "confirm payment");
const afterConfirm = data<any>(app.call("deal.get", { id: dealId }, agent));
assert(afterConfirm.paid_amount === 12000, "paid after confirm");
assert(afterConfirm.unpaid_amount === 18000, "unpaid after confirm");
assert(afterConfirm.pending_amount === 0, "pending cleared");
assert(
  afterConfirm.payments.some((p: any) => p.id === paymentId && p.status === "confirmed"),
  "confirmed payment in detail"
);

const second = app.call(
  "payment.create",
  { deal_id: dealId, amount: 18000, method: "cash", payer_side: "owner" },
  finance
);
assert(second.ok, "second payment");
assert(app.call("payment.confirm", { id: data<any>(second).id }, finance).ok, "confirm second");
const settled = data<any>(app.call("deal.get", { id: dealId }, manager));
assert(settled.paid_amount === 30000 && settled.unpaid_amount === 0, "fully paid triad");
assert(!settled.overpaid, "not overpaid at exact settle");

const refund = app.call(
  "payment.refund",
  { deal_id: dealId, amount: 5000, method: "transfer", reason: "部分退佣" },
  finance
);
assert(refund.ok, "refund");
const afterRefund = data<any>(app.call("deal.get", { id: dealId }, finance));
assert(afterRefund.paid_amount === 25000, "net paid after refund");
assert(afterRefund.unpaid_amount === 5000, "unpaid after refund");
assert(
  afterRefund.payments.some((p: any) => p.direction === "out" && p.amount === 5000),
  "refund listed in payments"
);

console.log(`Deal amounts smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
