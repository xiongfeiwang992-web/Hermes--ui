import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "bonus-calculated-notify-smoke.db")).dbPath
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
const calcMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "performance" && m.title === "管理奖已核算"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const finance = login("finance");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const managerMe = data<any>(app.call("auth.me", {}, manager));
const storeId = managerMe.store_id;
const periodMonth = new Date().toISOString().slice(0, 7);
const dealDate = `${periodMonth}-15`;

assert(
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
  "configure award rate"
);

const house = app.call(
  "house.create",
  {
    title: "管理奖核算房源",
    deal_type: "sale",
    community: "管理奖小区",
    price: 200,
    owner_name: "管理奖业主",
    owner_phone: "13680001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "管理奖客户", phone: "13680002222", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 190,
    commission_owner: 10000,
    commission_customer: 0,
    deal_date: dealDate,
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
    "performance.bonus.create",
    { store_id: storeId, period_month: periodMonth },
    manager
  ).ok,
  "manager cannot create bonus"
);

assert(
  app.call("message.subscriptions.save", { channels: { performance: false } }, manager).ok,
  "mute performance"
);
const beforeMuted = calcMsgs(manager).length;
const mutedBatch = app.call(
  "performance.bonus.create",
  { store_id: storeId, period_month: periodMonth },
  finance
);
assert(mutedBatch.ok, "finance creates bonus while muted");
assert(calcMsgs(manager).length === beforeMuted, "muted performance suppresses calculated message");

// Use a different store path isn't available; unmute and create would duplicate.
// Unmute and verify paid path still works separately — recreate by voiding isn't available.
// Instead unmute and confirm message kind mapping with a second period isn't needed:
assert(
  app.call("message.subscriptions.save", { channels: { performance: true } }, manager).ok,
  "unmute performance"
);

// Create batch for proof with unmuted — need different month with deal.
const altMonth = periodMonth.endsWith("12")
  ? `${Number(periodMonth.slice(0, 4)) + 1}-01`
  : `${periodMonth.slice(0, 5)}${String(Number(periodMonth.slice(5)) + 1).padStart(2, "0")}`;
const altDate = `${altMonth}-10`;
const house2 = app.call(
  "house.create",
  {
    title: "管理奖核算房源2",
    deal_type: "sale",
    community: "管理奖小区",
    price: 210,
    owner_name: "管理奖业主2",
    owner_phone: "13680003333",
    status: "available",
  },
  agent
);
assert(house2.ok, "create house2");
const customer2 = app.call(
  "customer.create",
  { name: "管理奖客户2", phone: "13680004444", intent: "buy" },
  agent
);
assert(customer2.ok, "create customer2");
const deal2 = app.call(
  "deal.create",
  {
    house_id: data<any>(house2).id,
    customer_id: data<any>(customer2).id,
    contract_price: 200,
    commission_owner: 20000,
    commission_customer: 0,
    deal_date: altDate,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal2.ok, "create deal2");
assert(app.call("deal.submit", { id: data<any>(deal2).id }, agent).ok, "submit deal2");
assert(app.call("deal.approve", { id: data<any>(deal2).id }, manager).ok, "approve deal2");

const beforeManager = calcMsgs(manager).length;
const beforeFinance = calcMsgs(finance).length;
const batch = app.call(
  "performance.bonus.create",
  { store_id: storeId, period_month: altMonth },
  finance
);
assert(batch.ok, "finance creates unmuted bonus");
assert(data<any>(batch).bonus_total === 2000, "bonus total 10% of 20000");
assert(calcMsgs(manager).length === beforeManager + 1, "manager receives calculated message");
assert(calcMsgs(finance).length === beforeFinance, "finance actor does not self-notify");
assert(
  calcMsgs(manager).some(
    (m) =>
      m.ref_id === data<any>(batch).id &&
      String(m.body).includes(altMonth) &&
      String(m.body).includes("2000")
  ),
  "calculated message body"
);

console.log(`Bonus calculated notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
