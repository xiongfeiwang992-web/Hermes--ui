import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "deal-modes-smoke.db")).dbPath);
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

const defaults = data<any[]>(app.call("config.dealModes", {}, agent));
assert(defaults.length >= 3, "default deal modes available");
assert(
  defaults.some((item) => item.value === "normal" && item.label === "普通"),
  "default includes normal"
);
assert(
  defaults.some((item) => item.value === "exclusive" && item.label === "包销/独家"),
  "default includes exclusive"
);

const omitted = app.call(
  "house.create",
  {
    title: "默认模式房源",
    deal_type: "sale",
    community: "模式苑",
    price: 160,
    owner_name: "业主",
    owner_phone: "13370001001",
    status: "available",
  },
  agent
);
assert(omitted.ok, "create without deal_mode");
assert(data<any>(omitted).deal_mode === "normal", "defaults to normal");
assert(data<any>(omitted).deal_mode_label === "普通", "default label is 普通");

const alias = app.call(
  "house.create",
  {
    title: "别名模式房源",
    deal_type: "sale",
    community: "模式苑",
    price: 170,
    owner_name: "业主",
    owner_phone: "13370001002",
    deal_mode: "package",
    status: "available",
  },
  agent
);
assert(alias.ok, "package alias accepted");
assert(data<any>(alias).deal_mode === "exclusive", "package normalized to exclusive");
assert(data<any>(alias).deal_mode_label === "包销/独家", "exclusive label");

assert(
  !app.call(
    "house.create",
    {
      title: "非法模式房源",
      deal_type: "sale",
      community: "模式苑",
      price: 100,
      owner_name: "业主",
      owner_phone: "13370001003",
      deal_mode: "carrier_pigeon",
      status: "available",
    },
    agent
  ).ok,
  "reject unknown deal mode"
);

const auction = app.call(
  "house.create",
  {
    title: "拍卖模式房源",
    deal_type: "sale",
    community: "模式苑",
    price: 300,
    owner_name: "业主",
    owner_phone: "13370001004",
    deal_mode: "auction",
    status: "available",
  },
  agent
);
assert(auction.ok, "create auction house");
const auctionId = data<any>(auction).id;
assert(
  data<any[]>(app.call("house.list", { deal_mode: "auction" }, agent)).some(
    (row) => row.id === auctionId
  ),
  "list filter by deal_mode"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "deal_mode", value: "joint", label: "联卖", sort_order: 10 },
    admin
  ).ok,
  "admin adds custom deal mode"
);
const modes = data<any[]>(app.call("config.dealModes", {}, agent));
assert(
  modes.some((item) => item.value === "joint" && item.label === "联卖"),
  "dealModes includes custom entry"
);
assert(!modes.some((item) => item.value === "normal"), "custom dictionary replaces defaults");

assert(
  !app.call(
    "house.create",
    {
      title: "默认被覆盖",
      deal_type: "sale",
      community: "模式苑",
      price: 90,
      owner_name: "业主",
      owner_phone: "13370001005",
      deal_mode: "normal",
      status: "available",
    },
    agent
  ).ok,
  "default mode rejected after custom dictionary overrides"
);

const custom = app.call(
  "house.create",
  {
    title: "联卖房源",
    deal_type: "sale",
    community: "模式苑",
    price: 250,
    owner_name: "业主",
    owner_phone: "13370001006",
    deal_mode: "joint",
    status: "available",
  },
  agent
);
assert(custom.ok, "create with custom deal mode");
assert(data<any>(custom).deal_mode === "joint", "custom mode stored");
assert(data<any>(custom).deal_mode_label === "联卖", "custom mode label");

const updated = app.call("house.update", { id: auctionId, deal_mode: "joint" }, agent);
assert(updated.ok, "update to custom deal mode");
assert(data<any>(updated).deal_mode === "joint", "updated mode stored");
assert(
  !app.call("house.update", { id: auctionId, deal_mode: "carrier_pigeon" }, agent).ok,
  "update rejects unknown deal mode"
);

console.log(`Deal modes smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
