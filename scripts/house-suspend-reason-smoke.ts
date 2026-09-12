import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-suspend-reason-smoke.db")).dbPath
);
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
const manager = login("manager");
const agent = login("agent_a");

const defaults = data<any[]>(app.call("config.houseSuspendReasons", {}, agent));
assert(defaults.length >= 5, "default suspend reasons available");
assert(
  defaults.some((item) => item.value === "owner_pause" && item.label.includes("业主暂缓")),
  "default includes owner_pause"
);
assert(
  defaults.some((item) => item.value === "price_adjust" && item.label === "调价中"),
  "default includes price_adjust"
);
assert(
  data<any[]>(app.call("config.houseSuspendReasons", {}, manager)).length >= 5,
  "manager can read suspend reasons"
);

const mkHouse = (title: string, phone: string) => {
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "暂缓字典苑",
      price: 199,
      owner_name: "业主",
      owner_phone: phone,
      status: "available",
      remark: "原始备注保留",
    },
    agent
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
};

const h1 = mkHouse("暂缓原因一", "13680004501");
assert(
  !app.call("house.status", { id: h1, status: "suspended", reason: "" }, agent).ok,
  "suspend requires reason"
);
assert(
  !app.call(
    "house.status",
    { id: h1, status: "suspended", reason: "carrier_pigeon" },
    agent
  ).ok,
  "reject unknown suspend reason"
);

const alias = app.call(
  "house.status",
  { id: h1, status: "suspended", reason: "业主暂缓" },
  agent
);
assert(alias.ok, "chinese alias accepted");
const suspended = data<any>(app.call("house.get", { id: h1 }, agent));
assert(suspended.status === "suspended", "house suspended");
assert(suspended.suspend_reason === "owner_pause", "alias normalized");
assert(suspended.suspend_reason_label.includes("业主暂缓"), "label present");
assert(suspended.remark === "原始备注保留", "remark not overwritten");

const listed = data<any[]>(app.call("house.list", { status: "suspended" }, manager));
assert(
  listed.some(
    (row) =>
      row.id === h1 &&
      row.suspend_reason === "owner_pause" &&
      String(row.suspend_reason_label || "").includes("业主暂缓")
  ),
  "list shows suspend reason label"
);

assert(
  app.call("house.status", { id: h1, status: "available" }, agent).ok,
  "resume from suspended"
);
const resumed = data<any>(app.call("house.get", { id: h1 }, agent));
assert(resumed.status === "available", "house available again");
assert(resumed.suspend_reason === "owner_pause", "suspend reason retained after resume");

assert(
  !app.call(
    "config.dictionary.upsert",
    {
      dict_type: "house_suspend_reason",
      value: "policy_hold",
      label: "政策观望",
      sort_order: 20,
    },
    manager
  ).ok,
  "manager cannot upsert suspend reason dictionary"
);

assert(
  app.call(
    "config.dictionary.upsert",
    {
      dict_type: "house_suspend_reason",
      value: "policy_hold",
      label: "政策观望",
      sort_order: 20,
    },
    admin
  ).ok,
  "admin adds custom suspend reason"
);

const customTypes = data<any[]>(app.call("config.houseSuspendReasons", {}, agent));
assert(
  customTypes.some((item) => item.value === "policy_hold" && item.label === "政策观望"),
  "custom dictionary overrides defaults"
);
assert(
  !customTypes.some((item) => item.value === "owner_pause"),
  "custom dictionary replaces defaults when present"
);

const h2 = mkHouse("暂缓原因二", "13680004502");
assert(
  !app.call(
    "house.status",
    { id: h2, status: "suspended", reason: "owner_pause" },
    agent
  ).ok,
  "default reason rejected after custom dictionary enabled"
);
assert(
  app.call(
    "house.status",
    { id: h2, status: "suspended", reason: "policy_hold" },
    agent
  ).ok,
  "custom reason accepted"
);
const customHouse = data<any>(app.call("house.get", { id: h2 }, agent));
assert(
  customHouse.suspend_reason === "policy_hold" &&
    customHouse.suspend_reason_label === "政策观望",
  "custom reason persisted with label"
);

console.log(`House suspend reason smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
