import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "commission-paid-smoke.db")).dbPath);
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
    title: "提成发放盘",
    deal_type: "sale",
    community: "提成苑",
    price: 200,
    owner_name: "业主",
    owner_phone: "13680013001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "提成客", phone: "13680013002", intent: "buy" },
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
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve");

const listed = data<any[]>(app.call("commission.list", {}, finance)).filter(
  (row) => row.deal_id === dealId && row.user_id === agentId
);
assert(listed.length === 1, "one agent commission");
const commissionId = listed[0].id;
assert(listed[0].status === "accrued", "starts accrued");
assert(listed[0].status_label === "应计", "status label accrued");
assert(Boolean(listed[0].user_name) && listed[0].user_name !== agentId, "user_name presented");

assert(
  !app.call("commission.paid", { id: commissionId }, agent).ok,
  "agent cannot mark paid"
);
assert(
  !app.call("commission.paid", { id: commissionId }, manager).ok,
  "manager cannot mark paid"
);
assert(
  !app.call("commission.paid", { id: "CM_missing" }, finance).ok,
  "missing commission rejected"
);

const paid = app.call("commission.paid", { id: commissionId }, finance);
assert(paid.ok, "finance marks paid");
assert(data<any>(paid).status === "paid", "returns paid status");
assert(data<any>(paid).status_label === "已发放", "returns paid label");

assert(
  !app.call("commission.paid", { id: commissionId }, finance).ok,
  "cannot mark paid twice"
);

const after = data<any[]>(app.call("commission.list", {}, agent)).find(
  (row) => row.id === commissionId
);
assert(after?.status === "paid" && after.status_label === "已发放", "agent sees paid");

assert(
  data<any[]>(app.call("message.list", {}, agent)).some(
    (msg) => msg.kind === "commission_paid" && msg.ref_id === commissionId
  ),
  "agent notified"
);

console.log(`Commission paid smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
