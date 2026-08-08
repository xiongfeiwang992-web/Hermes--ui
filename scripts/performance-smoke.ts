import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "performance-smoke.db"));
const app = createApp(seeded.dbPath);
let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentC = login("agent_c");
const agentAUser = data<any>(app.call("auth.me", {}, agentA));
const agentBUser = data<any>(app.call("auth.me", {}, agentB));
const managerUser = data<any>(app.call("auth.me", {}, manager));

check(
  data<any>(app.call("performance.options", {}, finance)).rules.length === 0,
  "finance receives empty performance write options"
);
check(
  !app.call(
    "performance.rules.save",
    { code: "SURVEY", name: "实勘积分", points: 10 },
    manager
  ).ok,
  "only admin can save point rules"
);
check(
  !app.call(
    "performance.rules.save",
    { code: "SURVEY", name: "实勘积分", points: 0 },
    admin
  ).ok,
  "point rule rejects zero points"
);
const rule = app.call(
  "performance.rules.save",
  {
    code: "SURVEY",
    name: "完成实勘",
    points: 10,
    applicable_role: "agent",
  },
  admin
);
check(rule.ok, "admin creates point rule");
const ruleId = data<any>(rule).id;
check(
  !app.call(
    "performance.points.create",
    {
      user_id: agentAUser.id,
      rule_id: ruleId,
      reason: "越权录入",
    },
    agentA
  ).ok,
  "agent cannot create point entries"
);
const pending = app.call(
  "performance.points.create",
  {
    user_id: agentAUser.id,
    rule_id: ruleId,
    reason: "完成实勘加分",
  },
  manager
);
check(
  pending.ok && data<any>(pending).status === "pending",
  "manager creates pending point entry from rule"
);
const pendingId = data<any>(pending).id;
check(
  data<any[]>(app.call("message.list", {}, admin)).some(
    (message) => message.ref_id === pendingId
  ),
  "admin receives pending point approval message"
);
check(
  data<any>(app.call("performance.points.list", {}, agentA)).entries.some(
    (item: any) => item.id === pendingId
  ),
  "employee sees own pending points"
);
check(
  data<any>(app.call("performance.points.list", {}, agentB)).entries.length === 0,
  "employee cannot see other employee points"
);
check(
  !app.call(
    "performance.points.review",
    { id: pendingId, status: "approved" },
    manager
  ).ok,
  "manager cannot approve point entries"
);
check(
  app.call(
    "performance.points.review",
    { id: pendingId, status: "approved" },
    admin
  ).ok,
  "admin approves point entry"
);
check(
  data<any>(app.call("performance.points.list", {}, agentA)).balance === 10,
  "approved points increase employee balance"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.ref_id === pendingId
  ),
  "employee receives point approval message"
);
const direct = app.call(
  "performance.points.create",
  {
    user_id: agentAUser.id,
    points: 5,
    reason: "管理员直接加分",
  },
  admin
);
check(
  direct.ok && data<any>(direct).status === "approved",
  "admin direct point entry is auto-approved"
);
check(
  data<any>(app.call("performance.points.list", {}, agentA)).balance === 15,
  "admin approved points accumulate"
);
const rejected = app.call(
  "performance.points.create",
  {
    user_id: agentBUser.id,
    points: 3,
    reason: "待驳回",
  },
  manager
);
const rejectedId = data<any>(rejected).id;
check(rejected.ok, "manager creates second pending point entry");
check(
  !app.call(
    "performance.points.review",
    { id: rejectedId, status: "rejected", reject_reason: "" },
    admin
  ).ok,
  "point rejection requires reason"
);
check(
  app.call(
    "performance.points.review",
    { id: rejectedId, status: "rejected", reject_reason: "凭证不足" },
    admin
  ).ok,
  "admin rejects pending point entry"
);

check(
  !app.call(
    "performance.targets.save",
    {
      period_month: "2026-13",
      metric: "commission",
      target_value: 10000,
      store_id: seeded.storeA,
    },
    manager
  ).ok,
  "target month validated"
);
const storeTarget = app.call(
  "performance.targets.save",
  {
    period_month: "2026-08",
    metric: "commission",
    target_value: 20000,
    store_id: seeded.storeA,
  },
  manager
);
check(storeTarget.ok, "manager creates store commission target");
const userTarget = app.call(
  "performance.targets.save",
  {
    period_month: "2026-08",
    metric: "deals",
    target_value: 2,
    store_id: seeded.storeA,
    user_id: agentAUser.id,
  },
  manager
);
check(userTarget.ok, "manager creates employee deal target");
check(
  !app.call(
    "performance.targets.save",
    {
      period_month: "2026-08",
      metric: "deals",
      target_value: 2,
      store_id: seeded.storeA,
      user_id: agentAUser.id,
    },
    manager
  ).ok,
  "duplicate target rejected"
);
const house = app.call(
  "house.create",
  {
    title: "积分分红成交房源",
    deal_type: "sale",
    community: "分红小区",
    price: 200,
    owner_name: "分红业主",
    owner_phone: "13770001111",
    status: "available",
  },
  agentA
);
const customer = app.call(
  "customer.create",
  { name: "分红客户", phone: "13870001111", intent: "buy" },
  agentA
);
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 190,
    commission_owner: 10000,
    commission_customer: 0,
    deal_date: "2026-08-10",
    agent_ids: [agentAUser.id],
    split_ratios: { [agentAUser.id]: 100 },
  },
  agentA
);
const dealId = data<any>(deal).id;
check(house.ok && customer.ok && deal.ok, "create deal for target progress");
check(app.call("deal.submit", { id: dealId }, agentA).ok, "submit performance deal");
check(app.call("deal.approve", { id: dealId }, manager).ok, "approve performance deal");
const targets = data<any[]>(app.call("performance.targets.list", { period_month: "2026-08" }, agentA));
const ownDealTarget = targets.find((item) => item.user_id === agentAUser.id);
const storeCommissionTarget = targets.find((item) => !item.user_id);
check(
  ownDealTarget?.actual_value === 1 && ownDealTarget.completion_rate === 50,
  "employee deal target progress computed"
);
check(
  storeCommissionTarget?.actual_value === 10000 &&
    storeCommissionTarget.completion_rate === 50,
  "store commission target progress computed"
);

check(
  app.call(
    "config.settings.save",
    {
      manager_award_rate: 0.1,
      house_hold_limit: 50,
      password_min_length: 8,
      deal_required_fields: [],
    },
    admin
  ).ok,
  "admin configures manager award rate"
);
check(
  !app.call(
    "performance.bonus.create",
    { store_id: seeded.storeA, period_month: "2026-08" },
    manager
  ).ok,
  "manager cannot create bonus batch"
);
const bonus = app.call(
  "performance.bonus.create",
  { store_id: seeded.storeA, period_month: "2026-08" },
  finance
);
check(
  bonus.ok &&
    data<any>(bonus).status === "calculated" &&
    data<any>(bonus).bonus_total === 1000,
  "finance calculates store manager bonus from approved commissions"
);
const bonusId = data<any>(bonus).id;
const bonusItems = app.call("performance.bonus.items", { batch_id: bonusId }, finance);
check(
  bonusItems.ok &&
    data<any[]>(bonusItems).length === 1 &&
    data<any[]>(bonusItems)[0].user_id === managerUser.id &&
    data<any[]>(bonusItems)[0].amount === 1000,
  "bonus item allocated to store manager"
);
check(
  !app.call("performance.bonus.items", { batch_id: bonusId }, agentA).ok,
  "agent cannot inspect bonus items"
);
check(
  !app.call(
    "performance.bonus.pay",
    { id: bonusId, payment_reference: "" },
    finance
  ).ok,
  "bonus payment requires reference"
);
check(
  app.call(
    "performance.bonus.pay",
    { id: bonusId, payment_reference: "BONUS-202608" },
    finance
  ).ok,
  "finance pays bonus batch"
);
check(
  data<any[]>(app.call("message.list", {}, manager)).some(
    (message) => message.ref_id === bonusId
  ),
  "manager receives bonus payment message"
);

check(
  !app.call(
    "performance.dividend.create",
    { period_month: "2026-08", pool_amount: 1500 },
    finance
  ).ok,
  "only admin can create dividend batch"
);
const dividend = app.call(
  "performance.dividend.create",
  { period_month: "2026-08", pool_amount: 1500 },
  admin
);
check(
  dividend.ok && data<any>(dividend).total_points === 15,
  "admin creates dividend batch from approved points"
);
const dividendId = data<any>(dividend).id;
check(
  !app.call("performance.dividend.items", { batch_id: dividendId }, agentA).ok,
  "employee cannot see unpaid dividend details"
);
const dividendItems = app.call(
  "performance.dividend.items",
  { batch_id: dividendId },
  admin
);
check(
  dividendItems.ok &&
    data<any[]>(dividendItems).some(
      (item) => item.user_id === agentAUser.id && item.share_amount === 1500
    ),
  "dividend allocated by approved points"
);
check(
  app.call(
    "performance.dividend.pay",
    { id: dividendId, payment_reference: "DIV-202608" },
    finance
  ).ok,
  "finance pays dividend batch"
);
check(
  data<any[]>(
    app.call("performance.dividend.items", { batch_id: dividendId }, agentA)
  ).some((item) => item.share_amount === 1500),
  "employee sees own paid dividend share"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.ref_id === dividendId
  ),
  "employee receives dividend payment message"
);
check(
  data<any[]>(app.call("performance.dividend.list", {}, agentC)).length === 0,
  "employee without share does not see dividend batches"
);

for (const type of ["points", "bonus", "dividend", "target"]) {
  check(
    !app.call(
      "suite.create",
      {
        module: "performance",
        record_type: type,
        title: `通用${type}`,
        data: {},
      },
      manager
    ).ok,
    `generic performance type ${type} disabled`
  );
}
const events = app.call(
  "performance.events",
  { entity_type: "point_entry", entity_id: pendingId },
  agentA
);
check(
  events.ok && data<any[]>(events).some((event) => event.event_type === "approved"),
  "point entry event history visible to owner"
);
const audits = data<any[]>(
  app.call("audit.list", { entity_type: "performance_dividend_batch" }, admin)
);
check(
  audits.some((item) => item.action === "performance.dividend.pay"),
  "dividend payment writes audit log"
);

console.log(`Performance smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
