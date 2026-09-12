import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "customer-levels-smoke.db")).dbPath);
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

const defaults = data<any[]>(app.call("config.customerLevels", {}, agent));
assert(defaults.length >= 3, "default customer levels available");
assert(
  defaults.some((item) => item.value === "A" && item.label === "A级"),
  "default includes A"
);
assert(
  defaults.some((item) => item.value === "B" && item.label === "B级"),
  "default includes B"
);

const defaultLevel = app.call(
  "customer.create",
  { name: "默认等级客", phone: "13660001001", intent: "buy" },
  agent
);
assert(defaultLevel.ok, "create defaults to B");
assert(data<any>(defaultLevel).level === "B", "default level is B");
assert(data<any>(defaultLevel).level_label === "B级", "default level_label");

const legacy = app.call(
  "customer.create",
  {
    name: "别名等级客",
    phone: "13660001002",
    intent: "buy",
    level: "a",
  },
  agent
);
assert(legacy.ok, "legacy lowercase a accepted");
assert(data<any>(legacy).level === "A", "a normalized to A");
assert(data<any>(legacy).level_label === "A级", "level_label for A");

assert(
  !app.call(
    "customer.create",
    {
      name: "非法等级客",
      phone: "13660001003",
      intent: "buy",
      level: "S+",
    },
    agent
  ).ok,
  "reject unknown customer level"
);

const labeled = app.call(
  "customer.create",
  {
    name: "中文别名客",
    phone: "13660001004",
    intent: "rent",
    level: "C级",
  },
  agent
);
assert(labeled.ok, "C级 alias accepted");
assert(data<any>(labeled).level === "C", "C级 normalized to C");
const labeledId = data<any>(labeled).id;

assert(
  data<any[]>(app.call("customer.list", { level: "c" }, agent)).some(
    (row) => row.id === labeledId
  ),
  "list filter by level alias"
);
assert(
  !data<any[]>(app.call("customer.list", { level: "A" }, agent)).some(
    (row) => row.id === labeledId
  ),
  "list filter excludes other levels"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "customer_level", value: "S", label: "S级重点", sort_order: 1 },
    admin
  ).ok,
  "admin adds custom customer level"
);
assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "customer_level", value: "A", label: "A级优质", sort_order: 2 },
    admin
  ).ok,
  "admin adds A into custom dict"
);

const customLevels = data<any[]>(app.call("config.customerLevels", {}, agent));
assert(
  customLevels.some((item) => item.value === "S" && item.label === "S级重点") &&
    !customLevels.some((item) => item.value === "B"),
  "custom dict overrides defaults"
);

const customCustomer = app.call(
  "customer.create",
  {
    name: "自定义等级客",
    phone: "13660001005",
    intent: "buy",
    level: "S",
  },
  agent
);
assert(customCustomer.ok, "create with custom level");
assert(data<any>(customCustomer).level === "S", "custom level stored");
assert(data<any>(customCustomer).level_label === "S级重点", "custom level_label");
const customId = data<any>(customCustomer).id;

assert(
  !app.call(
    "customer.create",
    {
      name: "被覆盖等级客",
      phone: "13660001006",
      intent: "buy",
      level: "B",
    },
    agent
  ).ok,
  "default B rejected after custom dict override"
);

const updated = app.call("customer.update", { id: customId, level: "A" }, agent);
assert(updated.ok, "update to allowed custom level");
assert(data<any>(app.call("customer.get", { id: customId }, agent)).level === "A", "updated level");
assert(
  data<any>(app.call("customer.get", { id: customId }, agent)).level_label === "A级优质",
  "updated level_label"
);

assert(
  !app.call("customer.update", { id: customId, level: "B" }, agent).ok,
  "update rejects level outside dict"
);

console.log(`Customer levels smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
