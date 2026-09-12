import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "house-dedupe-smoke.db")).dbPath);
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

const base = {
  deal_type: "sale",
  community: "查重苑",
  price: 300,
  owner_name: "业主甲",
  owner_phone: "13680004601",
  area_size: 90,
  status: "available",
};

const first = app.call(
  "house.create",
  { ...base, title: "查重底盘" },
  agent
);
assert(first.ok, "create base house");
assert(!data<any>(first).duplicate_hint, "first create has no hint");
const firstId = data<any>(first).id;

const phoneOnly = app.call(
  "house.create",
  {
    ...base,
    title: "仅同电话",
    community: "另一小区",
    area_size: 120,
  },
  agent
);
assert(phoneOnly.ok, "phone-only create succeeds");
assert(!data<any>(phoneOnly).duplicate_hint, "phone-only does not hint");

const communityAreaOnly = app.call(
  "house.create",
  {
    ...base,
    title: "同小区相近面积不同电话",
    owner_phone: "13680004602",
    area_size: 92,
  },
  agent
);
assert(communityAreaOnly.ok, "community+area create succeeds");
assert(!data<any>(communityAreaOnly).duplicate_hint, "community+area only does not hint");

const andMatch = app.call(
  "house.create",
  {
    ...base,
    title: "三条件命中",
    area_size: 93,
  },
  agent
);
assert(andMatch.ok, "AND match create succeeds");
assert(
  data<any>(andMatch).duplicate_hint?.id === firstId,
  "AND match hints original house"
);
assert(
  data<any>(andMatch).duplicate_hint?.title === "查重底盘",
  "AND match hint title"
);

const farArea = app.call(
  "house.create",
  {
    ...base,
    title: "面积差过大",
    area_size: 110,
  },
  agent
);
assert(farArea.ok, "far area create succeeds");
assert(!data<any>(farArea).duplicate_hint, "area delta >5 does not hint");

const noArea = app.call(
  "house.create",
  {
    ...base,
    title: "无面积不提示",
    area_size: null,
  },
  agent
);
assert(noArea.ok, "no area create succeeds");
assert(!data<any>(noArea).duplicate_hint, "missing area_size skips hint");

const andMatchId = data<any>(andMatch).id;
assert(
  app.call(
    "house.status",
    { id: firstId, status: "withdrawn", reason: "重复录入测试" },
    manager
  ).ok,
  "withdraw base house"
);
assert(
  app.call(
    "house.status",
    { id: andMatchId, status: "withdrawn", reason: "重复录入测试" },
    manager
  ).ok,
  "withdraw AND-match house"
);
const afterWithdraw = app.call(
  "house.create",
  {
    ...base,
    title: "已撤盘不再提示",
    area_size: 91,
  },
  agent
);
assert(afterWithdraw.ok, "create after withdraw succeeds");
assert(
  !data<any>(afterWithdraw).duplicate_hint,
  "withdrawn houses excluded from dedupe"
);

console.log(`House dedupe smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
