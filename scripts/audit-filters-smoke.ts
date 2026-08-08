import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "audit-filters-smoke.db")).dbPath);
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
assert(!!agentAId && !!agentBId, "resolve agent ids");

const houseA = app.call(
  "house.create",
  {
    title: "审计筛选一号盘",
    deal_type: "sale",
    community: "审计苑",
    price: 210,
    owner_name: "审计业主甲",
    owner_phone: "13780001111",
    status: "available",
  },
  agentA
);
assert(houseA.ok, "agent_a creates house");
const houseAId = data<any>(houseA).id;

const houseB = app.call(
  "house.create",
  {
    title: "审计筛选二号盘",
    deal_type: "rent",
    community: "审计苑",
    price: 4200,
    owner_name: "审计业主乙",
    owner_phone: "13780002222",
    status: "available",
  },
  agentB
);
assert(houseB.ok, "agent_b creates house");
const houseBId = data<any>(houseB).id;

const customer = app.call(
  "customer.create",
  {
    name: "审计筛选客",
    phone: "13680003333",
    intent: "buy",
  },
  agentA
);
assert(customer.ok, "agent_a creates customer");

const byAction = app.call("audit.list", { action: "house.create", limit: 500 }, admin);
assert(byAction.ok, "admin lists audit by action");
const actionRows = data<any[]>(byAction);
assert(
  actionRows.length >= 2 && actionRows.every((row) => row.action.includes("house.create")),
  "action substring filter keeps house.create"
);
assert(
  actionRows.some((row) => row.user_name === "经纪人甲") &&
    actionRows.some((row) => row.user_name === "经纪人乙"),
  "audit rows include user display names"
);

const byTargetType = app.call(
  "audit.list",
  { action: "create", target_type: "house", limit: 500 },
  admin
);
assert(byTargetType.ok, "admin filters by target_type");
const typeRows = data<any[]>(byTargetType);
assert(
  typeRows.length >= 2 && typeRows.every((row) => row.target_type === "house"),
  "target_type filter keeps house only"
);
assert(
  !typeRows.some((row) => row.target_type === "customer"),
  "target_type filter excludes customer"
);

const byUser = app.call(
  "audit.list",
  { user_id: agentAId, action: "house.create", limit: 500 },
  admin
);
assert(byUser.ok, "admin filters by user_id");
const userRows = data<any[]>(byUser);
assert(
  userRows.length >= 1 &&
    userRows.every((row) => row.user_id === agentAId && row.user_name === "经纪人甲"),
  "user_id filter and display name for agent_a"
);
assert(
  !userRows.some((row) => row.user_id === agentBId),
  "user_id filter excludes agent_b"
);

const byTargetId = app.call("audit.list", { target_id: houseAId, limit: 500 }, admin);
assert(byTargetId.ok, "admin filters by target_id");
const targetRows = data<any[]>(byTargetId);
assert(
  targetRows.length >= 1 &&
    targetRows.every((row) => row.target_id === houseAId) &&
    targetRows.some((row) => row.action === "house.create" && row.user_name === "经纪人甲"),
  "target_id exact filter returns matching house audit"
);
assert(
  !targetRows.some((row) => row.target_id === houseBId),
  "target_id filter excludes other houses"
);

const managerView = app.call(
  "audit.list",
  { action: "house.create", target_type: "house", limit: 500 },
  manager
);
assert(managerView.ok, "store_manager can list audit");
assert(
  data<any[]>(managerView).some((row) => row.target_id === houseAId && row.user_name),
  "store_manager sees store audit with display name"
);

const financeDenied = app.call("audit.list", { limit: 20 }, finance);
assert(
  !financeDenied.ok && financeDenied.code === 403,
  "finance cannot access audit list"
);

const agentDenied = app.call("audit.list", { limit: 20 }, agentA);
assert(!agentDenied.ok && agentDenied.code === 403, "agent cannot access audit list");

console.log(`Audit filters smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
