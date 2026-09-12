import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "deal-void-smoke.db")).dbPath);
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
const finance = login("finance");
const agent = login("agent_a");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const createApprovedDeal = (title: string, phone: string) => {
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "作废苑",
      price: 200,
      owner_name: "业主",
      owner_phone: phone.replace(/2$/, "1"),
      status: "available",
    },
    agent
  );
  assert(house.ok, `create house ${title}`);
  const customer = app.call(
    "customer.create",
    { name: `客-${title}`, phone, intent: "buy" },
    agent
  );
  assert(customer.ok, `create customer ${title}`);
  const deal = app.call(
    "deal.create",
    {
      house_id: data<any>(house).id,
      customer_id: data<any>(customer).id,
      contract_price: 200,
      commission_owner: 10000,
      commission_customer: 8000,
      agent_ids: [agentId],
      split_ratios: { [agentId]: 100 },
    },
    agent
  );
  assert(deal.ok, `create deal ${title}`);
  const dealId = data<any>(deal).id;
  assert(app.call("deal.submit", { id: dealId }, agent).ok, `submit ${title}`);
  assert(app.call("deal.approve", { id: dealId }, manager).ok, `approve ${title}`);
  return {
    dealId,
    houseId: data<any>(house).id,
    customerId: data<any>(customer).id,
  };
};

const clean = createApprovedDeal("可作废成交", "13680003001");

assert(
  !app.call("deal.void", { id: clean.dealId, reason: "越权" }, manager).ok,
  "manager cannot void"
);
assert(
  !app.call("deal.void", { id: clean.dealId, reason: "越权" }, finance).ok,
  "finance cannot void"
);
assert(
  !app.call("deal.void", { id: clean.dealId, reason: "" }, admin).ok,
  "void requires reason"
);

const voided = app.call("deal.void", { id: clean.dealId, reason: "录错房客需重开" }, admin);
assert(voided.ok && data<any>(voided).status === "void", "admin voids approved deal");
assert(data<any>(voided).void_reason === "录错房客需重开", "void reason persisted");
assert(data<any>(voided).voided_by && data<any>(voided).voided_at, "void metadata persisted");

const house = app.db.prepare(`SELECT status FROM houses WHERE id=?`).get(clean.houseId) as any;
const customer = app.db
  .prepare(`SELECT status FROM customers WHERE id=?`)
  .get(clean.customerId) as any;
assert(house?.status === "available", "house restored available");
assert(customer?.status === "viewing", "customer restored viewing");

const commissions = data<any[]>(app.call("commission.list", {}, finance));
assert(
  commissions
    .filter((row) => row.deal_id === clean.dealId)
    .every((row) => row.status === "void"),
  "commissions voided"
);

assert(
  !app.call("deal.void", { id: clean.dealId, reason: "再次作废" }, admin).ok,
  "cannot void already voided"
);
assert(
  !app.call(
    "payment.create",
    { deal_id: clean.dealId, amount: 1000, method: "transfer", payer_side: "customer" },
    finance
  ).ok,
  "cannot pay voided deal"
);

const listed = app.call("deal.list", {}, admin);
assert(
  listed.ok &&
    data<any[]>(listed).some((row) => row.id === clean.dealId && row.status === "void"),
  "list shows voided deal"
);

const blocked = createApprovedDeal("有收款不可作废", "13680003002");
const pay = app.call(
  "payment.create",
  {
    deal_id: blocked.dealId,
    amount: 3000,
    method: "transfer",
    payer_side: "customer",
  },
  finance
);
assert(pay.ok, "create pending payment");
assert(
  !app.call("deal.void", { id: blocked.dealId, reason: "有待确认" }, admin).ok,
  "pending payment blocks void"
);
assert(app.call("payment.confirm", { id: data<any>(pay).id }, finance).ok, "confirm payment");
assert(
  !app.call("deal.void", { id: blocked.dealId, reason: "有已确认收款" }, admin).ok,
  "confirmed payment blocks void"
);

const paidBlock = createApprovedDeal("有提成发放不可作废", "13680003003");
const cms = data<any[]>(app.call("commission.list", {}, finance)).filter(
  (row) => row.deal_id === paidBlock.dealId && row.status === "accrued"
);
assert(cms.length >= 1, "has accrued commission");
assert(app.call("commission.paid", { id: cms[0]!.id }, finance).ok, "mark commission paid");
assert(
  !app.call("deal.void", { id: paidBlock.dealId, reason: "已发提成" }, admin).ok,
  "paid commission blocks void"
);

const audit = app.call("audit.list", { action: "deal.void", limit: 20 }, admin);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "deal.void"),
  "void writes audit"
);

const messages = app.call("message.list", {}, agent);
assert(
  messages.ok &&
    (data<any[]>(messages) || []).some(
      (row) => row.kind === "deal_void" && String(row.body || "").includes(clean.dealId)
    ),
  "agent notified of void"
);

console.log(`Deal void smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
