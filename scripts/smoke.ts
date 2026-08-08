import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const dbPath = path.resolve("data", "smoke.db");
seedDatabase(dbPath);
const app = createApp(dbPath);

let passed = 0;
let failed = 0;

function assert(cond: any, msg: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error("FAIL:", msg);
  }
}

function login(account: string) {
  const res = app.call("auth.login", { account, password: "123456" });
  assert(res.ok, `${account} login`);
  return res.ok ? ((res.data as any).token as string) : "";
}

function dataOf<T = any>(res: any): T {
  return res.data as T;
}

const tokenA = login("agent_a");
const tokenB = login("agent_b");
const tokenM = login("manager");
const tokenF = login("finance");
const tokenC = login("agent_c");

const meA = app.call("auth.me", {}, tokenA);
const agentAId = dataOf<any>(meA).id;

const house = app.call(
  "house.create",
  {
    title: "阳光花园 2室",
    deal_type: "sale",
    community: "阳光花园",
    price: 180,
    owner_name: "张业主",
    owner_phone: "13800001111",
    status: "available",
    is_private: false,
  },
  tokenA
);
assert(house.ok, "create house");
const houseId = dataOf<any>(house).id;

const secret = app.call(
  "house.create",
  {
    title: "保密盘",
    deal_type: "sale",
    community: "隐秘苑",
    price: 300,
    owner_name: "保密业主",
    owner_phone: "13900002222",
    status: "available",
    is_private: true,
  },
  tokenA
);
assert(secret.ok, "create private house");

const listB = app.call("house.list", {}, tokenB);
assert(listB.ok, "agent_b list houses");
const idsB = (dataOf<any[]>(listB) || []).map((h) => h.id);
assert(!idsB.includes(dataOf<any>(secret).id), "private house hidden from other agent");

const customer = app.call(
  "customer.create",
  {
    name: "李先生",
    phone: "13700003333",
    intent: "buy",
    level: "A",
    need: "两室刚需",
  },
  tokenA
);
assert(customer.ok, "create customer");
const customerId = dataOf<any>(customer).id;

const listOther = app.call("customer.list", {}, tokenB);
assert(listOther.ok, "agent_b list customers");
assert(
  !(dataOf<any[]>(listOther) || []).some((c) => c.id === customerId),
  "private customer hidden from other agent"
);

const follow = app.call(
  "follow.create",
  {
    target_type: "customer",
    target_id: customerId,
    content: "电话沟通意向明确",
    method: "call",
    next_follow_at: new Date().toISOString(),
  },
  tokenA
);
assert(follow.ok, "create follow");

const view = app.call(
  "view.create",
  {
    customer_id: customerId,
    house_id: houseId,
    view_at: new Date().toISOString(),
  },
  tokenA
);
assert(view.ok, "create view");
const viewId = dataOf<any>(view).id;
assert(
  app.call(
    "view.complete",
    { id: viewId, feedback: "interested", content: "客户很满意" },
    tokenA
  ).ok,
  "complete view"
);

const deal = app.call(
  "deal.create",
  {
    house_id: houseId,
    customer_id: customerId,
    view_id: viewId,
    contract_price: 175,
    commission_owner: 20000,
    commission_customer: 15000,
    agent_ids: [agentAId],
    split_ratios: { [agentAId]: 100 },
  },
  tokenA
);
assert(deal.ok, "create deal");
const dealId = dataOf<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, tokenA).ok, "submit deal");
assert(app.call("deal.approve", { id: dealId }, tokenM).ok, "approve deal");

const pay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 35000, method: "transfer", payer_side: "customer" },
  tokenF
);
assert(pay.ok, "create payment");

const commissions = app.call("commission.list", {}, tokenA);
assert(commissions.ok, "list commissions");
assert((dataOf<any[]>(commissions) || []).length >= 1, "commission accrued");
const amount = (dataOf<any[]>(commissions) || [])[0].amount;
assert(Math.abs(amount - 17500) < 0.01, `commission amount 17500 got ${amount}`);

const financeHouse = app.call("house.list", {}, tokenF);
assert(!financeHouse.ok, "finance cannot list houses");

const cross = app.call("customer.list", {}, tokenC);
assert(cross.ok, "store B list");
assert(
  !(dataOf<any[]>(cross) || []).some((c) => c.id === customerId),
  "cross-store private customer isolated"
);

const dash = app.call("report.dashboard", {}, tokenM);
assert(dash.ok, "dashboard");

console.log(`Smoke result: passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
