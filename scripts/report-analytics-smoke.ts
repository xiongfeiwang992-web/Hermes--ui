import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "report-analytics-smoke.db")).dbPath);
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
const finance = login("finance");
const otherStore = login("agent_c");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const month = new Date().toISOString().slice(0, 7);

const houseA = app.call(
  "house.create",
  {
    title: "热点一号",
    deal_type: "sale",
    property_type: "residential",
    community: "热点花园",
    price: 220,
    area_size: 95,
    owner_name: "业主甲",
    owner_phone: "13440001111",
    status: "available",
  },
  agent
);
assert(houseA.ok, "create sale house A");
const houseB = app.call(
  "house.create",
  {
    title: "热点二号",
    deal_type: "rent",
    property_type: "office",
    community: "热点花园",
    price: 5500,
    area_size: 70,
    owner_name: "业主乙",
    owner_phone: "13440002222",
    status: "available",
  },
  agent
);
assert(houseB.ok, "create rent house B");
const houseC = app.call(
  "house.create",
  {
    title: "外店房源",
    deal_type: "sale",
    community: "外店小区",
    price: 180,
    area_size: 80,
    owner_name: "外店业主",
    owner_phone: "13440003333",
    status: "available",
  },
  otherStore
);
assert(houseC.ok, "create other-store house");

const customerA = app.call(
  "customer.create",
  {
    name: "来源客户甲",
    phone: "13440004444",
    intent: "buy",
    source: "官网",
  },
  agent
);
assert(customerA.ok, "create customer with source");
const customerB = app.call(
  "customer.create",
  {
    name: "来源客户乙",
    phone: "13440005555",
    intent: "rent",
    source: "转介",
  },
  agent
);
assert(customerB.ok, "create second customer");
const customerC = app.call(
  "customer.create",
  { name: "无来源客户", phone: "13440006666", intent: "buy" },
  agent
);
assert(customerC.ok, "create customer without source");

const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(houseA).id,
    customer_id: data<any>(customerA).id,
    contract_price: 220,
    commission_owner: 12000,
    commission_customer: 8000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve deal");

const hotspots = data<any>(app.call("report.dealHotspots", { month }, manager));
assert(hotspots.deal_count >= 1, "hotspots include approved deals");
assert(
  hotspots.by_community.some(
    (row: any) => row.community === "热点花园" && row.count >= 1 && row.commission_total >= 20000
  ),
  "hotspots group by community"
);
assert(
  hotspots.by_price_band.some((row: any) => row.price_band === "200-299万"),
  "hotspots group by price band"
);
assert(
  hotspots.by_area_band.some((row: any) => row.area_band === "90-119㎡"),
  "hotspots group by area band"
);

const agentHotspots = data<any>(app.call("report.dealHotspots", { month }, agent));
assert(agentHotspots.deal_count >= 1, "agent sees own deal hotspots");
const crossHotspots = data<any>(app.call("report.dealHotspots", { month }, otherStore));
assert(
  !crossHotspots.by_community.some((row: any) => row.community === "热点花园"),
  "other store isolated from deal hotspots"
);

const attrs = data<any>(app.call("report.houseAttributes", {}, manager));
assert(attrs.house_count >= 2, "house attributes count");
assert(
  attrs.by_deal_type.some((row: any) => row.deal_type === "sale" && row.count >= 1) &&
    attrs.by_deal_type.some((row: any) => row.deal_type === "rent" && row.count >= 1),
  "house attributes by deal type"
);
assert(
  attrs.by_property_type.some(
    (row: any) => row.property_type === "office" && row.deal_type === "rent"
  ),
  "house attributes by property type"
);
assert(
  !app.call("report.houseAttributes", {}, finance).ok,
  "finance cannot view house attributes"
);

const sources = data<any>(app.call("report.customerSources", {}, manager));
assert(
  sources.by_source.some((row: any) => row.source === "官网" && row.count >= 1) &&
    sources.by_source.some((row: any) => row.source === "转介" && row.count >= 1) &&
    sources.by_source.some((row: any) => row.source === "未填写" && row.count >= 1),
  "customer sources grouped"
);
assert(
  !app.call("report.customerSources", {}, finance).ok,
  "finance cannot view customer sources"
);

for (const [action, token, withMonth] of [
  ["report.dealHotspotsCsv", manager, true],
  ["report.houseAttributesCsv", manager, false],
  ["report.customerSourcesCsv", manager, false],
] as const) {
  const result = app.call(action, withMonth ? { month } : {}, token);
  assert(result.ok && data<any>(result).content.startsWith("\uFEFF"), `${action} utf8 csv`);
  assert(Number(data<any>(result).rows) > 0, `${action} has rows`);
}

assert(
  !app.call("report.houseAttributesCsv", {}, finance).ok,
  "finance cannot export house attributes"
);

console.log(`Report analytics smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
