import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "house-list-filters-smoke.db")).dbPath);
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

const agentA = login("agent_a");
const agentB = login("agent_b");
const manager = login("manager");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const mk = (token: string, title: string, community: string, price: number) => {
  const result = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community,
      price,
      owner_name: "业主",
      owner_phone: `1368${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      status: "available",
    },
    token
  );
  assert(result.ok, `create ${title}`);
  return data<any>(result);
};

const hLow = mk(agentA, "低价盘", "筛选甲苑", 120);
const hMid = mk(agentA, "中价盘", "筛选甲苑", 220);
const hHigh = mk(agentB, "高价盘", "筛选乙苑", 380);

const byCommunity = data<any[]>(app.call("house.list", { community: "甲苑" }, manager));
assert(
  byCommunity.every((row) => String(row.community).includes("甲苑")) &&
    byCommunity.some((row) => row.id === hLow.id) &&
    byCommunity.some((row) => row.id === hMid.id) &&
    !byCommunity.some((row) => row.id === hHigh.id),
  "filter by community"
);

const byAgent = data<any[]>(app.call("house.list", { agent_id: agentBId }, manager));
assert(
  byAgent.every((row) => row.agent_id === agentBId) && byAgent.some((row) => row.id === hHigh.id),
  "filter by agent"
);

const byPrice = data<any[]>(
  app.call("house.list", { price_min: 200, price_max: 300 }, manager)
);
assert(
  byPrice.every((row) => row.price >= 200 && row.price <= 300) &&
    byPrice.some((row) => row.id === hMid.id) &&
    !byPrice.some((row) => row.id === hLow.id) &&
    !byPrice.some((row) => row.id === hHigh.id),
  "filter by price range"
);

const unpaged = data<any[]>(app.call("house.list", {}, manager));
assert(Array.isArray(unpaged) && unpaged.length >= 3, "unpaginated list remains array");

const page1 = data<any>(app.call("house.list", { page: 1, page_size: 2 }, manager));
assert(Array.isArray(page1.items) && page1.items.length === 2, "page 1 size");
assert(page1.total >= 3, "page total");
assert(page1.page === 1 && page1.page_size === 2, "page meta");

const page2 = data<any>(app.call("house.list", { page: 2, page_size: 2 }, manager));
assert(Array.isArray(page2.items) && page2.items.length >= 1, "page 2 has items");
assert(
  !page1.items.some((row: any) => page2.items.some((other: any) => other.id === row.id)),
  "pages disjoint"
);

const filteredPage = data<any>(
  app.call(
    "house.list",
    { community: "甲苑", agent_id: agentAId, page: 1, page_size: 10 },
    manager
  )
);
assert(
  filteredPage.total === 2 &&
    filteredPage.items.every(
      (row: any) => row.agent_id === agentAId && String(row.community).includes("甲苑")
    ),
  "combined filters with pagination"
);

const emptyPage = data<any>(
  app.call("house.list", { community: "不存在的小区XYZ", page: 1, page_size: 10 }, manager)
);
assert(emptyPage.total === 0 && emptyPage.items.length === 0, "empty page");

console.log(`House list filters smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
