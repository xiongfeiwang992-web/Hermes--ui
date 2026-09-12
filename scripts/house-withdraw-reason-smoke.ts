import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-withdraw-reason-smoke.db")).dbPath
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

const defaults = data<any[]>(app.call("config.houseWithdrawReasons", {}, agent));
assert(defaults.length >= 5, "default withdraw reasons available");
assert(
  defaults.some((item) => item.value === "owner_stopped" && item.label === "业主不卖/不租"),
  "default includes owner_stopped"
);
assert(
  defaults.some((item) => item.value === "sold_elsewhere" && item.label === "已他售/他租"),
  "default includes sold_elsewhere"
);
assert(
  data<any[]>(app.call("config.houseWithdrawReasons", {}, manager)).length >= 5,
  "manager can read withdraw reasons"
);

const mkHouse = (title: string, phone: string) => {
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "撤盘字典苑",
      price: 188,
      owner_name: "业主",
      owner_phone: phone,
      status: "available",
      remark: "原始备注勿覆盖",
    },
    agent
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
};

const h1 = mkHouse("撤盘原因一", "13680004301");
assert(
  !app.call("house.status", { id: h1, status: "withdrawn", reason: "" }, agent).ok,
  "withdraw requires reason"
);
assert(
  !app.call(
    "house.status",
    { id: h1, status: "withdrawn", reason: "carrier_pigeon" },
    agent
  ).ok,
  "reject unknown withdraw reason"
);

const alias = app.call(
  "house.status",
  { id: h1, status: "withdrawn", reason: "业主不卖" },
  agent
);
assert(alias.ok, "chinese alias accepted");
const withdrawn = data<any>(app.call("house.get", { id: h1 }, agent));
assert(withdrawn.status === "withdrawn", "house withdrawn");
assert(withdrawn.withdraw_reason === "owner_stopped", "alias normalized");
assert(withdrawn.withdraw_reason_label === "业主不卖/不租", "label present");
assert(withdrawn.remark === "原始备注勿覆盖", "remark not overwritten by withdraw");

const listed = data<any[]>(app.call("house.list", { status: "withdrawn" }, manager));
assert(
  listed.some(
    (row) =>
      row.id === h1 &&
      row.withdraw_reason === "owner_stopped" &&
      row.withdraw_reason_label === "业主不卖/不租"
  ),
  "list shows withdraw reason label"
);

assert(
  !app.call(
    "config.dictionary.upsert",
    {
      dict_type: "house_withdraw_reason",
      value: "renovation",
      label: "装修中停售",
      sort_order: 20,
    },
    manager
  ).ok,
  "manager cannot upsert withdraw reason dictionary"
);

assert(
  app.call(
    "config.dictionary.upsert",
    {
      dict_type: "house_withdraw_reason",
      value: "renovation",
      label: "装修中停售",
      sort_order: 20,
    },
    admin
  ).ok,
  "admin adds custom withdraw reason"
);

const customTypes = data<any[]>(app.call("config.houseWithdrawReasons", {}, agent));
assert(
  customTypes.some((item) => item.value === "renovation" && item.label === "装修中停售"),
  "custom dictionary overrides defaults"
);
assert(
  !customTypes.some((item) => item.value === "owner_stopped"),
  "custom dictionary replaces defaults when present"
);

const h2 = mkHouse("撤盘原因二", "13680004302");
assert(
  !app.call(
    "house.status",
    { id: h2, status: "withdrawn", reason: "owner_stopped" },
    agent
  ).ok,
  "default reason rejected after custom dictionary enabled"
);
assert(
  app.call(
    "house.status",
    { id: h2, status: "withdrawn", reason: "renovation" },
    agent
  ).ok,
  "custom reason accepted"
);
const customHouse = data<any>(app.call("house.get", { id: h2 }, agent));
assert(
  customHouse.withdraw_reason === "renovation" &&
    customHouse.withdraw_reason_label === "装修中停售",
  "custom reason persisted with label"
);

console.log(`House withdraw reason smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
