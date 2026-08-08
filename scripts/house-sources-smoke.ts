import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "house-sources-smoke.db")).dbPath);
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
const agent = login("agent_a");

const defaults = data<any[]>(app.call("config.houseSources", {}, agent));
assert(defaults.length >= 4, "default house sources available");
assert(
  defaults.some((item) => item.value === "官网" && item.label === "官网"),
  "default includes 官网"
);

const none = app.call(
  "house.create",
  {
    title: "无来源盘",
    deal_type: "sale",
    community: "来源测试一号院",
    price: 100,
    owner_name: "业主甲",
    owner_phone: "13750001001",
    status: "available",
  },
  agent
);
assert(none.ok, "create without source");
assert(!data<any>(none).source, "source stays empty");

const legacy = app.call(
  "house.create",
  {
    title: "别名来源盘",
    deal_type: "sale",
    community: "来源测试二号院",
    price: 120,
    owner_name: "业主乙",
    owner_phone: "13750001002",
    source: "walk_in",
    status: "available",
  },
  agent
);
assert(legacy.ok, "legacy walk_in accepted");
assert(data<any>(legacy).source === "门店到访", "walk_in normalized to 门店到访");
assert(data<any>(legacy).source_label === "门店到访", "source_label present");

assert(
  !app.call(
    "house.create",
    {
      title: "非法来源盘",
      deal_type: "sale",
      community: "来源测试三号院",
      price: 130,
      owner_name: "业主丙",
      owner_phone: "13750001003",
      source: "carrier_pigeon",
      status: "available",
    },
    agent
  ).ok,
  "reject unknown house source"
);

const official = app.call(
  "house.create",
  {
    title: "官网来源盘",
    deal_type: "rent",
    community: "来源测试四号院",
    price: 3500,
    owner_name: "业主丁",
    owner_phone: "13750001004",
    source: "官网",
    status: "available",
  },
  agent
);
assert(official.ok, "create with default source");
const officialId = data<any>(official).id;

assert(
  data<any[]>(app.call("house.list", { source: "官网" }, agent)).some(
    (row) => row.id === officialId
  ),
  "list filter by source"
);
assert(
  !data<any[]>(app.call("house.list", { source: "转介" }, agent)).some(
    (row) => row.id === officialId
  ),
  "list filter excludes other sources"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "house_source", value: "短视频", label: "短视频投放", sort_order: 10 },
    admin
  ).ok,
  "admin adds custom house source"
);
const sources = data<any[]>(app.call("config.houseSources", {}, agent));
assert(
  sources.some((item) => item.value === "短视频" && item.label === "短视频投放"),
  "houseSources includes custom entry"
);
assert(
  !sources.some((item) => item.value === "官网"),
  "custom dictionary replaces defaults"
);

assert(
  !app.call(
    "house.create",
    {
      title: "默认源被替换",
      deal_type: "sale",
      community: "来源测试五号院",
      price: 150,
      owner_name: "业主戊",
      owner_phone: "13750001005",
      source: "官网",
      status: "available",
    },
    agent
  ).ok,
  "default source rejected after custom dictionary overrides"
);

const custom = app.call(
  "house.create",
  {
    title: "短视频来源盘",
    deal_type: "sale",
    community: "来源测试六号院",
    price: 160,
    owner_name: "业主己",
    owner_phone: "13750001006",
    source: "短视频",
    status: "available",
  },
  agent
);
assert(custom.ok, "create with custom source");
assert(data<any>(custom).source === "短视频", "custom source stored");
assert(data<any>(custom).source_label === "短视频投放", "custom source label");

const updated = app.call("house.update", { id: officialId, source: "短视频" }, agent);
assert(updated.ok, "update source to custom value");
assert(data<any>(updated).source === "短视频", "updated source stored");

assert(
  !app.call("house.update", { id: officialId, source: "carrier_pigeon" }, agent).ok,
  "update rejects unknown source"
);

console.log(`House sources smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
