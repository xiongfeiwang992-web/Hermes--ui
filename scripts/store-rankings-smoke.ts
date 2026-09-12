import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "store-rankings-smoke.db"));
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
const agentC = login("agent_c");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentCId = data<any>(app.call("auth.me", {}, agentC)).id;

check(
  !app.call("performance.rankings.monthly", { period_month: "2026-13" }, admin).ok,
  "reject invalid ranking month"
);

const storeTargetA = app.call(
  "performance.targets.save",
  {
    period_month: "2026-08",
    metric: "commission",
    target_value: 20000,
    store_id: seeded.storeA,
  },
  manager
);
check(storeTargetA.ok, "create store A commission target");
const agentTarget = app.call(
  "performance.targets.save",
  {
    period_month: "2026-08",
    metric: "deals",
    target_value: 2,
    store_id: seeded.storeA,
    user_id: agentAId,
  },
  manager
);
check(agentTarget.ok, "create agent A deal target");
const storeTargetB = app.call(
  "performance.targets.save",
  {
    period_month: "2026-08",
    metric: "commission",
    target_value: 30000,
    store_id: seeded.storeB,
  },
  admin
);
check(storeTargetB.ok, "admin creates store B commission target");

const makeDeal = (token: string, agentId: string, title: string, phone: string, commission: number) => {
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "排名小区",
      price: 200,
      owner_name: "排名业主",
      owner_phone: phone,
      status: "available",
    },
    token
  );
  const customer = app.call(
    "customer.create",
    { name: `客户-${phone}`, phone: phone.replace(/^13/, "138"), intent: "buy" },
    token
  );
  const deal = app.call(
    "deal.create",
    {
      house_id: data<any>(house).id,
      customer_id: data<any>(customer).id,
      contract_price: 190,
      commission_owner: commission,
      commission_customer: 0,
      deal_date: "2026-08-12",
      agent_ids: [agentId],
      split_ratios: { [agentId]: 100 },
    },
    token
  );
  check(house.ok && customer.ok && deal.ok, `create deal ${title}`);
  const dealId = data<any>(deal).id;
  check(app.call("deal.submit", { id: dealId }, token).ok, `submit ${title}`);
  check(app.call("deal.approve", { id: dealId }, admin).ok, `approve ${title}`);
  return dealId;
};

makeDeal(agentA, agentAId, "一号店高佣成交", "13780000001", 25000);
makeDeal(agentC, agentCId, "二号店低佣成交", "13780000002", 8000);

const adminBoard = app.call(
  "performance.rankings.monthly",
  { period_month: "2026-08" },
  admin
);
check(adminBoard.ok, "admin loads monthly rankings");
const board = data<any>(adminBoard);
check(board.stores.length === 2, "admin sees both stores");
check(
  board.stores[0].store_id === seeded.storeA &&
    board.stores[0].commission_total === 25000 &&
    board.stores[0].rank === 1,
  "store A ranks first by commission"
);
check(
  board.stores[1].store_id === seeded.storeB &&
    board.stores[1].commission_total === 8000,
  "store B ranks second"
);
check(
  board.stores[0].completion_rate === 125 &&
    board.stores[0].target_value === 20000 &&
    board.stores[0].actual_value === 25000,
  "store A target completion rate computed"
);
check(
  board.stores[1].completion_rate === moneyish(8000 / 30000 * 100),
  "store B target completion rate computed"
);

const agentARow = board.agents.find((row: any) => row.user_id === agentAId);
const agentCRow = board.agents.find((row: any) => row.user_id === agentCId);
check(agentARow && agentARow.rank === 1 && agentARow.performance === 25000, "agent A tops person board");
check(
  agentARow.completion_rate === 50 &&
    agentARow.metric === "deals" &&
    agentARow.actual_value === 1,
  "agent A deal target completion on board"
);
check(agentCRow && agentCRow.performance === 8000, "agent C appears with store B performance");

const managerBoard = data<any>(
  app.call("performance.rankings.monthly", { period_month: "2026-08" }, manager)
);
check(
  managerBoard.stores.length === 1 &&
    managerBoard.stores[0].store_id === seeded.storeA &&
    managerBoard.agents.every((row: any) => row.store_id === seeded.storeA),
  "store manager scoped to own store rankings"
);

const agentBoard = data<any>(
  app.call("performance.rankings.monthly", { period_month: "2026-08" }, agentA)
);
check(
  agentBoard.stores.length === 1 &&
    agentBoard.agents.length === 1 &&
    agentBoard.agents[0].user_id === agentAId,
  "agent only sees self on person board"
);

function moneyish(value: number) {
  return Math.round(value * 100) / 100;
}

console.log(`Store rankings smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
