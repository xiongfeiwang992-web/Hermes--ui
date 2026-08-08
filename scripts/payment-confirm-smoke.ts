import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "payment-confirm-smoke.db")).dbPath);
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

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const finance = login("finance");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const house = app.call(
  "house.create",
  {
    title: "出纳确认房源",
    deal_type: "sale",
    community: "到账苑",
    price: 300,
    owner_name: "业主",
    owner_phone: "13660001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "到账客户", phone: "13660002222", intent: "buy" },
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
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve deal");

assert(
  !app.call(
    "payment.create",
    { deal_id: dealId, amount: 10000, method: "transfer" },
    agent
  ).ok,
  "agent cannot register payment"
);

const pendingPay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 10000, method: "transfer", payer_side: "customer" },
  finance
);
assert(pendingPay.ok, "finance registers payment");
const paymentId = data<any>(pendingPay).id;
assert(data<any>(pendingPay).status === "pending", "create returns pending status");
assert(
  data<any>(app.call("deal.get", { id: dealId }, finance)).paid_amount === 0,
  "pending payment does not count as paid"
);

assert(
  !app.call("payment.refund", { deal_id: dealId, amount: 1000, reason: "提前退" }, finance)
    .ok,
  "cannot refund before confirm"
);
assert(
  !app.call("payment.reject", { id: paymentId, reason: "x" }, finance).ok,
  "reject requires longer reason"
);
assert(
  !app.call("payment.confirm", { id: paymentId }, agent).ok,
  "agent cannot confirm payment"
);

const rejected = app.call(
  "payment.create",
  { deal_id: dealId, amount: 5000, method: "cash", payer_side: "owner" },
  admin
);
assert(rejected.ok, "admin registers second payment");
const rejectId = data<any>(rejected).id;
assert(
  app.call("payment.reject", { id: rejectId, reason: "未查到银行流水" }, finance).ok,
  "finance rejects pending payment"
);
assert(
  data<any[]>(app.call("payment.list", { status: "rejected" }, finance)).some(
    (row) => row.id === rejectId && row.reject_reason === "未查到银行流水"
  ),
  "rejected payment listed with reason"
);
assert(
  data<any>(app.call("deal.get", { id: dealId }, finance)).paid_amount === 0,
  "rejected payment still not paid"
);

const confirmed = app.call("payment.confirm", { id: paymentId }, finance);
assert(confirmed.ok, "finance confirms payment");
assert(data<any>(confirmed).status === "confirmed", "confirm returns confirmed");
assert(
  data<any>(app.call("deal.get", { id: dealId }, finance)).paid_amount === 10000,
  "confirmed payment counts as paid"
);
assert(
  !app.call("payment.confirm", { id: paymentId }, finance).ok,
  "cannot confirm twice"
);
assert(
  !app.call("payment.reject", { id: paymentId, reason: "已确认不可驳回" }, finance).ok,
  "cannot reject confirmed payment"
);

assert(
  data<any[]>(app.call("message.list", {}, agent)).some(
    (msg) => msg.kind === "payment" && String(msg.body).includes("已出纳确认")
  ),
  "agent receives confirm message"
);

assert(
  app.call(
    "payment.refund",
    { deal_id: dealId, amount: 2000, reason: "佣金调整退回", method: "transfer" },
    finance
  ).ok,
  "refund after confirm"
);
assert(
  data<any>(app.call("deal.get", { id: dealId }, finance)).paid_amount === 8000,
  "refund reduces net paid"
);

const pendingList = data<any[]>(app.call("payment.list", { status: "pending" }, finance));
assert(
  pendingList.every((row) => row.status === "pending"),
  "status filter returns pending only"
);

console.log(`Payment confirm smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
