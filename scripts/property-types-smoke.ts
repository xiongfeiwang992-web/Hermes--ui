import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "property-types-smoke.db")).dbPath);
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

const defaults = data<any[]>(app.call("config.propertyTypes", {}, agent));
assert(defaults.length >= 5, "default property types available");
assert(
  defaults.some((item) => item.value === "residential" && item.label === "住宅"),
  "default includes residential"
);
assert(
  defaults.some((item) => item.value === "office" && item.label === "写字楼"),
  "default includes office"
);

const omitted = app.call(
  "house.create",
  {
    title: "默认物业房源",
    deal_type: "sale",
    community: "字典苑",
    price: 180,
    owner_name: "业主",
    owner_phone: "13560001001",
    status: "available",
  },
  agent
);
assert(omitted.ok, "create house without property_type");
assert(data<any>(omitted).property_type === "residential", "defaults to residential");
assert(data<any>(omitted).property_type_label === "住宅", "default label is 住宅");

const alias = app.call(
  "house.create",
  {
    title: "别名物业房源",
    deal_type: "rent",
    community: "字典苑",
    price: 4500,
    owner_name: "业主",
    owner_phone: "13560001002",
    property_type: "apartment",
    status: "available",
  },
  agent
);
assert(alias.ok, "alias apartment accepted");
assert(data<any>(alias).property_type === "residential", "apartment normalized to residential");

assert(
  !app.call(
    "house.create",
    {
      title: "非法物业房源",
      deal_type: "sale",
      community: "字典苑",
      price: 100,
      owner_name: "业主",
      owner_phone: "13560001003",
      property_type: "carrier_pigeon",
      status: "available",
    },
    agent
  ).ok,
  "reject unknown property type"
);

const office = app.call(
  "house.create",
  {
    title: "写字楼房源",
    deal_type: "rent",
    community: "商务中心",
    price: 12000,
    owner_name: "业主",
    owner_phone: "13560001004",
    property_type: "office",
    status: "available",
  },
  agent
);
assert(office.ok, "create office house");
const officeId = data<any>(office).id;
assert(
  data<any[]>(app.call("house.list", { property_type: "office" }, agent)).some(
    (row) => row.id === officeId
  ),
  "list filter by property_type"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "property_type", value: "warehouse", label: "仓储", sort_order: 10 },
    admin
  ).ok,
  "admin adds custom property type"
);
const types = data<any[]>(app.call("config.propertyTypes", {}, agent));
assert(
  types.some((item) => item.value === "warehouse" && item.label === "仓储"),
  "propertyTypes includes custom entry"
);
assert(
  !types.some((item) => item.value === "residential"),
  "custom dictionary replaces defaults"
);

assert(
  !app.call(
    "house.create",
    {
      title: "默认被覆盖",
      deal_type: "sale",
      community: "字典苑",
      price: 90,
      owner_name: "业主",
      owner_phone: "13560001005",
      property_type: "residential",
      status: "available",
    },
    agent
  ).ok,
  "default type rejected after custom dictionary overrides"
);

const custom = app.call(
  "house.create",
  {
    title: "仓储房源",
    deal_type: "rent",
    community: "物流园",
    price: 8000,
    owner_name: "业主",
    owner_phone: "13560001006",
    property_type: "warehouse",
    status: "available",
  },
  agent
);
assert(custom.ok, "create with custom property type");
assert(data<any>(custom).property_type === "warehouse", "custom type stored");
assert(data<any>(custom).property_type_label === "仓储", "custom type label");

const updated = app.call("house.update", { id: officeId, property_type: "warehouse" }, agent);
assert(updated.ok, "update to custom property type");
assert(data<any>(updated).property_type === "warehouse", "updated type stored");
assert(
  !app.call("house.update", { id: officeId, property_type: "carrier_pigeon" }, agent).ok,
  "update rejects unknown property type"
);

const attrs = data<any>(app.call("report.houseAttributes", {}, admin));
assert(
  attrs.by_property_type.some(
    (row: any) =>
      row.property_type === "warehouse" &&
      row.property_type_label === "仓储" &&
      row.count >= 1
  ),
  "report shows custom property type label"
);

console.log(`Property types smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
