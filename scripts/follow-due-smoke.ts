import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "follow-due-smoke.db")).dbPath);
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
const todayKey = new Date().toISOString().slice(0, 10);
const dayOffset = (days: number) => {
  const d = new Date(`${todayKey}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
};

const agentA = login("agent_a");
const agentB = login("agent_b");
const manager = login("manager");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;

const house = app.call(
  "house.create",
  {
    title: "待跟进盘",
    deal_type: "sale",
    community: "跟进苑",
    price: 200,
    owner_name: "业主",
    owner_phone: "13680009001",
    status: "available",
  },
  agentA
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const customer = app.call(
  "customer.create",
  { name: "待跟进客", phone: "13680009002", intent: "buy" },
  agentA
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const mkFollow = (token: string, target_type: string, target_id: string, next: string, content: string) => {
  const result = app.call(
    "follow.create",
    {
      target_type,
      target_id,
      content,
      method: "phone",
      next_follow_at: next,
    },
    token
  );
  assert(result.ok, `create ${content}`);
  return data<any>(result);
};

const overdue = mkFollow(agentA, "house", houseId, dayOffset(-2), "逾期应回访业主");
const todayFollow = mkFollow(agentA, "customer", customerId, dayOffset(0), "今日联系客户意向");
const upcoming = mkFollow(agentA, "house", houseId, dayOffset(3), "三天后二次跟进盘");
const far = mkFollow(agentA, "customer", customerId, dayOffset(20), "二十天后再联系客户");
const otherAgent = mkFollow(agentB, "house", houseId, dayOffset(0), "乙经纪人今日跟进同盘");

const dueMine = data<any[]>(app.call("follow.list", { due: "due" }, agentA));
assert(
  dueMine.every((row) => row.created_by === agentAId) &&
    dueMine.some((row) => row.id === overdue.id) &&
    dueMine.some((row) => row.id === todayFollow.id) &&
    !dueMine.some((row) => row.id === upcoming.id) &&
    !dueMine.some((row) => row.id === otherAgent.id),
  "due filter is mine and <= today"
);

const todayRows = data<any[]>(app.call("follow.list", { due: "today" }, agentA));
assert(
  todayRows.every((row) => String(row.next_follow_at).slice(0, 10) === todayKey) &&
    todayRows.some((row) => row.id === todayFollow.id) &&
    !todayRows.some((row) => row.id === overdue.id),
  "today filter"
);

const overdueRows = data<any[]>(app.call("follow.list", { due: "overdue" }, agentA));
assert(
  overdueRows.some((row) => row.id === overdue.id) &&
    !overdueRows.some((row) => row.id === todayFollow.id),
  "overdue filter"
);

const upcomingRows = data<any[]>(app.call("follow.list", { due: "upcoming" }, agentA));
assert(
  upcomingRows.some((row) => row.id === upcoming.id) &&
    !upcomingRows.some((row) => row.id === far.id) &&
    !upcomingRows.some((row) => row.id === todayFollow.id) &&
    !upcomingRows.some((row) => row.id === overdue.id),
  "upcoming within 7 days excludes today/overdue/far"
);

const titled = data<any[]>(app.call("follow.list", { due: "due" }, agentA));
const houseFollow = titled.find((row) => row.id === overdue.id);
const customerFollow = titled.find((row) => row.id === todayFollow.id);
assert(houseFollow?.target_title === "待跟进盘", "house target_title");
assert(customerFollow?.target_title === "待跟进客", "customer target_title");
assert(Boolean(houseFollow?.target_subtitle), "house target_subtitle");

const ordered = data<any[]>(app.call("follow.list", { due: "due" }, agentA));
const dates = ordered.map((row) => String(row.next_follow_at));
assert(
  dates.length >= 2 && dates.slice().sort().join("|") === dates.join("|"),
  "due list sorted by next_follow_at"
);

const managerDue = data<any[]>(app.call("follow.list", { due: "today" }, manager));
assert(
  managerDue.some((row) => row.id === todayFollow.id) &&
    managerDue.some((row) => row.id === otherAgent.id),
  "manager sees store today follows"
);

const dash = data<any>(app.call("report.dashboard", {}, agentA));
assert(Number(dash.follow_today) >= 1, "dashboard today count");
assert(Number(dash.follow_overdue) >= 1, "dashboard overdue count");

console.log(`Follow due smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
