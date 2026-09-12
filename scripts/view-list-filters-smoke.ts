import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "view-list-filters-smoke.db")).dbPath);
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
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

assert(!app.call("view.list", {}, finance).ok, "finance cannot list views");

const house = app.call(
  "house.create",
  {
    title: "带看筛选房",
    deal_type: "sale",
    community: "筛选苑",
    price: 210,
    owner_name: "业主",
    owner_phone: "13680004201",
    status: "available",
  },
  agentA
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const customer = app.call(
  "customer.create",
  { name: "带看筛选客", phone: "13680004202", intent: "buy" },
  agentA
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const mkView = (token: string, viewAt: string, agentId?: string) =>
  app.call(
    "view.create",
    {
      customer_id: customerId,
      house_id: houseId,
      view_at: viewAt,
      agent_id: agentId,
    },
    token
  );

const vEarly = mkView(agentA, "2026-08-01T10:00:00.000Z");
const vMid = mkView(agentA, "2026-08-05T10:00:00.000Z");
const vLate = mkView(agentA, "2026-08-09T10:00:00.000Z", agentBId);
assert(vEarly.ok && vMid.ok && vLate.ok, "create three views");
assert(data<any>(vLate).agent_id === agentBId, "late view assigned to agent_b");
const earlyId = data<any>(vEarly).id;
const midId = data<any>(vMid).id;
const lateId = data<any>(vLate).id;

assert(
  app.call("view.complete", { id: midId, feedback: "interested", content: "有意向" }, agentA).ok,
  "complete mid view"
);
assert(
  app.call("view.cancel", { id: earlyId, reason: "客户临时有事" }, agentA).ok,
  "cancel early view"
);

const all = data<any[]>(app.call("view.list", {}, manager));
assert(
  all.some((r) => r.id === earlyId) &&
    all.some((r) => r.id === midId) &&
    all.some((r) => r.id === lateId),
  "manager sees all store views"
);

const byAgentA = data<any[]>(app.call("view.list", { agent_id: agentAId }, manager));
assert(
  byAgentA.every((r) => r.agent_id === agentAId) &&
    byAgentA.some((r) => r.id === midId) &&
    !byAgentA.some((r) => r.id === lateId),
  "filter by agent_id"
);

const byStatusDone = data<any[]>(app.call("view.list", { status: "done" }, manager));
assert(
  byStatusDone.every((r) => r.status === "done") && byStatusDone.some((r) => r.id === midId),
  "filter by status done"
);

const byStatusPlanned = data<any[]>(app.call("view.list", { status: "planned" }, manager));
assert(
  byStatusPlanned.every((r) => r.status === "planned") &&
    byStatusPlanned.some((r) => r.id === lateId) &&
    !byStatusPlanned.some((r) => r.id === midId),
  "filter by status planned"
);

const byFeedback = data<any[]>(app.call("view.list", { feedback: "interested" }, manager));
assert(
  byFeedback.every((r) => r.feedback === "interested") &&
    byFeedback.some((r) => r.id === midId),
  "filter by feedback"
);

const byFrom = data<any[]>(app.call("view.list", { view_from: "2026-08-05" }, manager));
assert(
  byFrom.every((r) => String(r.view_at).slice(0, 10) >= "2026-08-05") &&
    byFrom.some((r) => r.id === midId) &&
    byFrom.some((r) => r.id === lateId) &&
    !byFrom.some((r) => r.id === earlyId),
  "filter by view_from"
);

const byTo = data<any[]>(app.call("view.list", { view_to: "2026-08-05" }, manager));
assert(
  byTo.every((r) => String(r.view_at).slice(0, 10) <= "2026-08-05") &&
    byTo.some((r) => r.id === earlyId) &&
    byTo.some((r) => r.id === midId) &&
    !byTo.some((r) => r.id === lateId),
  "filter by view_to"
);

const byRange = data<any[]>(
  app.call("view.list", { view_from: "2026-08-05", view_to: "2026-08-05" }, manager)
);
assert(
  byRange.length === 1 && byRange[0]!.id === midId,
  "filter by date range exact day"
);

const byAlias = data<any[]>(
  app.call("view.list", { from: "2026-08-09", to: "2026-08-09" }, admin)
);
assert(byAlias.some((r) => r.id === lateId) && byAlias.every((r) => r.id === lateId || String(r.view_at).slice(0,10) === "2026-08-09"), "from/to aliases work");

const combo = data<any[]>(
  app.call(
    "view.list",
    { agent_id: agentAId, status: "done", feedback: "interested", view_from: "2026-08-01" },
    manager
  )
);
assert(combo.length === 1 && combo[0]!.id === midId, "combined filters");

const agentList = data<any[]>(app.call("view.list", { status: "planned" }, agentA));
assert(
  agentList.every((r) => r.store_id === data<any>(app.call("auth.me", {}, agentA)).store_id),
  "agent list stays in store scope"
);

console.log(`View list filters smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
