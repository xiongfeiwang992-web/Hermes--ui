import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "customer-sources-smoke.db")).dbPath);
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

const defaults = data<any[]>(app.call("config.customerSources", {}, agent));
assert(defaults.length >= 4, "default customer sources available");
assert(
  defaults.some((item) => item.value === "官网" && item.label === "官网"),
  "default includes 官网"
);

const none = app.call(
  "customer.create",
  { name: "无来源客", phone: "13650001001", intent: "buy" },
  agent
);
assert(none.ok, "create without source");
assert(!data<any>(none).source, "source stays empty");

const legacy = app.call(
  "customer.create",
  {
    name: "别名来源客",
    phone: "13650001002",
    intent: "buy",
    source: "walk_in",
  },
  agent
);
assert(legacy.ok, "legacy walk_in accepted");
assert(data<any>(legacy).source === "门店到访", "walk_in normalized to 门店到访");
assert(data<any>(legacy).source_label === "门店到访", "source_label present");

assert(
  !app.call(
    "customer.create",
    {
      name: "非法来源客",
      phone: "13650001003",
      intent: "buy",
      source: "carrier_pigeon",
    },
    agent
  ).ok,
  "reject unknown customer source"
);

const official = app.call(
  "customer.create",
  {
    name: "官网客",
    phone: "13650001004",
    intent: "rent",
    source: "官网",
  },
  agent
);
assert(official.ok, "create with default source");
const officialId = data<any>(official).id;

assert(
  data<any[]>(app.call("customer.list", { source: "官网" }, agent)).some(
    (row) => row.id === officialId
  ),
  "list filter by source"
);
assert(
  !data<any[]>(app.call("customer.list", { source: "转介" }, agent)).some(
    (row) => row.id === officialId
  ),
  "list filter excludes other sources"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "customer_source", value: "短视频", label: "短视频投放", sort_order: 10 },
    admin
  ).ok,
  "admin adds custom customer source"
);
const sources = data<any[]>(app.call("config.customerSources", {}, agent));
assert(
  sources.some((item) => item.value === "短视频" && item.label === "短视频投放"),
  "customerSources includes custom entry"
);
assert(
  !sources.some((item) => item.value === "官网"),
  "custom dictionary replaces defaults"
);

assert(
  !app.call(
    "customer.create",
    {
      name: "默认源被替换",
      phone: "13650001005",
      intent: "buy",
      source: "官网",
    },
    agent
  ).ok,
  "default source rejected after custom dictionary overrides"
);

const custom = app.call(
  "customer.create",
  {
    name: "短视频客",
    phone: "13650001006",
    intent: "buy",
    source: "短视频",
  },
  agent
);
assert(custom.ok, "create with custom source");
assert(data<any>(custom).source === "短视频", "custom source stored");
assert(data<any>(custom).source_label === "短视频投放", "custom source label");

const updated = app.call("customer.update", { id: officialId, source: "短视频" }, agent);
assert(updated.ok, "update source to custom value");
assert(data<any>(updated).source === "短视频", "updated source stored");

assert(
  !app.call("customer.update", { id: officialId, source: "carrier_pigeon" }, agent).ok,
  "update rejects unknown source"
);

const report = data<any>(app.call("report.customerSources", {}, admin));
assert(
  report.by_source.some(
    (row: any) => row.source === "短视频" && row.source_label === "短视频投放" && row.count >= 1
  ),
  "report shows custom source label"
);

console.log(`Customer sources smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
