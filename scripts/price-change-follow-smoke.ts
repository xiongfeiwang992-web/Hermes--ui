import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "price-change-follow-smoke.db")).dbPath);
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

const manager = login("manager");
const agent = login("agent_a");

const house = app.call(
  "house.create",
  {
    title: "改价跟进房源",
    deal_type: "sale",
    community: "调价苑",
    price: 300,
    owner_name: "业主",
    owner_phone: "13770001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

assert(
  app.call("house.update", { id: houseId, price: 300 }, agent).ok,
  "noop price update ok"
);
assert(
  !data<any[]>(app.call("follow.list", { target_id: houseId }, agent)).some(
    (row) => row.follow_kind === "price_change"
  ),
  "noop price skips price_change follow"
);

const priced = app.call("house.update", { id: houseId, price: 288 }, agent);
assert(priced.ok, "price-only update ok");
const priceFollows = data<any[]>(
  app.call("follow.list", { target_id: houseId, follow_kind: "price_change" }, agent)
);
assert(priceFollows.length === 1, "exactly one price_change follow");
assert(String(priceFollows[0].content).includes("300→288"), "price_change content has diff");
assert(
  !data<any[]>(
    app.call("follow.list", { target_id: houseId, follow_kind: "modification" }, agent)
  ).length,
  "price-only update does not create modification follow"
);

const customer = app.call(
  "customer.create",
  { name: "改价筛选客户", phone: "13770002222", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;
assert(
  app.call(
    "follow.create",
    {
      target_type: "customer",
      target_id: customerId,
      content: "电话沟通客户预算与意向",
      method: "phone",
      follow_kind: "normal",
    },
    agent
  ).ok,
  "create customer normal follow"
);

const houseOnly = data<any[]>(app.call("follow.list", { target_type: "house" }, agent));
assert(
  houseOnly.every((row) => row.target_type === "house") &&
    houseOnly.some((row) => row.target_id === houseId),
  "filter by house target_type"
);
const customerOnly = data<any[]>(app.call("follow.list", { target_type: "customer" }, agent));
assert(
  customerOnly.every((row) => row.target_type === "customer") &&
    customerOnly.some((row) => row.target_id === customerId),
  "filter by customer target_type"
);
assert(
  data<any[]>(app.call("follow.list", { follow_kind: "price_change" }, agent)).every(
    (row) => row.follow_kind === "price_change"
  ),
  "filter by follow_kind price_change"
);

const csv = app.call("report.followsCsv", { follow_kind: "price_change" }, agent);
assert(csv.ok && data<any>(csv).content.startsWith("\uFEFF"), "export price_change follows csv");
assert(String(data<any>(csv).content).includes("改价跟进"), "csv uses kind label");
assert(String(data<any>(csv).content).includes("300→288"), "csv includes price diff");
assert(!String(data<any>(csv).content).includes(customerId), "filtered export excludes other kinds");

const month = new Date().toISOString().slice(0, 7);
const statsResult = app.call("report.activityStats", { month }, manager);
assert(statsResult.ok, "activity stats ok");
const stats = data<any>(statsResult);
assert(stats.follow_count >= 2, "activity stats include auto follows");
assert(
  stats.rankings.some((row: any) => row.price_change_count >= 1),
  "activity rankings count auto price_change"
);

assert(
  app.call("house.update", { id: houseId, title: "改价跟进房源（已更名）", price: 275 }, agent)
    .ok,
  "combined price and title update"
);
assert(
  data<any[]>(app.call("follow.list", { target_id: houseId, follow_kind: "price_change" }, agent))
    .length === 2,
  "second price_change recorded"
);
assert(
  data<any[]>(
    app.call("follow.list", { target_id: houseId, follow_kind: "modification" }, agent)
  ).some((row) => String(row.content).includes("标题")),
  "non-price fields still create modification follow"
);

console.log(`Price change follow smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
