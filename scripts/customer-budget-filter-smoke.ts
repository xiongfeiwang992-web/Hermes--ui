import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "customer-budget-filter-smoke.db")).dbPath);
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
const ids = (rows: any[]) => new Set(rows.map((r) => r.id));
const has = (rows: any[], id: string) => ids(rows).has(id);

const agent = login("agent_a");

const mid = data<any>(
  app.call(
    "customer.create",
    {
      name: "中段预算客",
      phone: "13660001001",
      intent: "buy",
      budget_min: 100,
      budget_max: 200,
    },
    agent
  )
).id;
assert(!!mid, "create mid-range budget customer");

const high = data<any>(
  app.call(
    "customer.create",
    {
      name: "高预算客",
      phone: "13660001002",
      intent: "buy",
      budget_min: 300,
      budget_max: 500,
    },
    agent
  )
).id;
assert(!!high, "create high budget customer");

const openHigh = data<any>(
  app.call(
    "customer.create",
    {
      name: "只填下限客",
      phone: "13660001003",
      intent: "rent",
      budget_min: 80,
    },
    agent
  )
).id;
assert(!!openHigh, "create open-high budget customer");

const openLow = data<any>(
  app.call(
    "customer.create",
    {
      name: "只填上限客",
      phone: "13660001004",
      intent: "rent",
      budget_max: 120,
    },
    agent
  )
).id;
assert(!!openLow, "create open-low budget customer");

const none = data<any>(
  app.call(
    "customer.create",
    {
      name: "无预算客",
      phone: "13660001005",
      intent: "buy",
    },
    agent
  )
).id;
assert(!!none, "create no-budget customer");

const all = data<any[]>(app.call("customer.list", {}, agent));
assert(has(all, mid) && has(all, none), "list without budget filter keeps all");

const byMin = data<any[]>(app.call("customer.list", { budget_min: 150 }, agent));
assert(has(byMin, mid), "budget_min 150 keeps mid (100-200)");
assert(has(byMin, high), "budget_min 150 keeps high (300-500)");
assert(has(byMin, openHigh), "budget_min 150 keeps open-high (>=80)");
assert(!has(byMin, openLow), "budget_min 150 excludes open-low (<=120)");
assert(!has(byMin, none), "budget_min excludes no-budget");

const byMax = data<any[]>(app.call("customer.list", { budget_max: 90 }, agent));
assert(has(byMax, openHigh), "budget_max 90 keeps open-high (>=80) via overlap");
assert(has(byMax, openLow), "budget_max 90 keeps open-low (<=120)");
assert(!has(byMax, mid), "budget_max 90 excludes mid 100-200");
assert(!has(byMax, high), "budget_max 90 excludes high");

const byBoth = data<any[]>(
  app.call("customer.list", { budget_min: 180, budget_max: 320 }, agent)
);
assert(has(byBoth, mid), "range 180-320 overlaps mid");
assert(has(byBoth, high), "range 180-320 overlaps high");
assert(has(byBoth, openHigh), "range 180-320 overlaps open-high");
assert(!has(byBoth, openLow), "range 180-320 excludes open-low");
assert(!has(byBoth, none), "range excludes no-budget");

const edgeTouch = data<any[]>(
  app.call("customer.list", { budget_min: 200, budget_max: 200 }, agent)
);
assert(has(edgeTouch, mid), "point 200 touches mid upper bound");
assert(!has(edgeTouch, high), "point 200 does not touch high");

const junk = data<any[]>(app.call("customer.list", { budget_min: "abc" }, agent));
assert(has(junk, none) && has(junk, mid), "non-numeric budget_min ignored");

console.log(`Customer budget filter smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
