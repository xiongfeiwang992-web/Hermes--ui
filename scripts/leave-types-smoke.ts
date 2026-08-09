import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "leave-types-smoke.db")).dbPath);
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

const defaults = data<any[]>(app.call("config.leaveTypes", {}, agent));
assert(defaults.length >= 4, "default leave types available");
assert(
  defaults.some((item) => item.value === "annual" && item.label === "年假"),
  "default includes annual"
);
assert(
  defaults.some((item) => item.value === "personal" && item.label === "事假"),
  "default includes personal"
);
assert(
  defaults.some((item) => item.value === "sick" && item.label === "病假"),
  "default includes sick"
);
assert(
  data<any[]>(app.call("config.leaveTypes", {}, manager)).length >= 4,
  "manager can read leave types"
);

const start = "2026-08-12T01:00:00.000Z";
const end = "2026-08-12T09:00:00.000Z";

assert(
  !app.call(
    "leave.create",
    { leave_type: "carrier_pigeon", start_at: start, end_at: end, reason: "无效类型测试" },
    agent
  ).ok,
  "reject unknown leave type"
);

const alias = app.call(
  "leave.create",
  { leave_type: "事假", start_at: start, end_at: end, reason: "家里有事请假一天" },
  agent
);
assert(alias.ok, "chinese alias accepted");
const aliasId = data<any>(alias).id;
assert(
  data<any[]>(app.call("leave.list", {}, agent)).some(
    (row) =>
      row.id === aliasId &&
      row.leave_type === "personal" &&
      row.leave_type_label === "事假"
  ),
  "alias normalized with label"
);

const byType = app.call("leave.list", { leave_type: "personal" }, manager);
assert(
  byType.ok &&
    data<any[]>(byType).every((row) => row.leave_type === "personal") &&
    data<any[]>(byType).some((row) => row.id === aliasId),
  "list filter by leave_type"
);

assert(
  !app.call(
    "config.dictionary.upsert",
    { dict_type: "leave_type", value: "marriage", label: "婚假", sort_order: 10 },
    manager
  ).ok,
  "manager cannot upsert leave type dictionary"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "leave_type", value: "marriage", label: "婚假", sort_order: 10 },
    admin
  ).ok,
  "admin adds custom leave type"
);

const customTypes = data<any[]>(app.call("config.leaveTypes", {}, agent));
assert(
  customTypes.some((item) => item.value === "marriage" && item.label === "婚假"),
  "leaveTypes includes custom entry"
);
assert(!customTypes.some((item) => item.value === "annual"), "custom dictionary replaces defaults");

assert(
  !app.call(
    "leave.create",
    {
      leave_type: "annual",
      start_at: "2026-08-13T01:00:00.000Z",
      end_at: "2026-08-13T05:00:00.000Z",
      reason: "默认类型应失败",
    },
    agent
  ).ok,
  "default type rejected after custom dictionary overrides"
);

const custom = app.call(
  "leave.create",
  {
    leave_type: "marriage",
    start_at: "2026-08-20T01:00:00.000Z",
    end_at: "2026-08-22T09:00:00.000Z",
    reason: "结婚请假三天办理手续",
  },
  agent
);
assert(custom.ok, "create with custom leave type");
assert(
  data<any[]>(app.call("leave.list", { leave_type: "marriage" }, manager)).some(
    (row) => row.id === data<any>(custom).id && row.leave_type_label === "婚假"
  ),
  "list shows custom leave type label"
);

const byAliasFilter = app.call("leave.list", { leave_type: "事假" }, agent);
assert(
  byAliasFilter.ok && data<any[]>(byAliasFilter).some((row) => row.id === aliasId),
  "list filter accepts leave type alias"
);

const annualAlias = app.call(
  "leave.create",
  {
    leave_type: "年假",
    start_at: "2026-09-01T01:00:00.000Z",
    end_at: "2026-09-01T05:00:00.000Z",
    reason: "年假别名应在自定义字典后失败",
  },
  agent
);
assert(!annualAlias.ok, "annual alias rejected after custom dictionary overrides");

const audit = app.call("audit.list", { action: "dictionary.upsert", limit: 20 }, admin);
assert(
  audit.ok &&
    (data<any[]>(audit) || []).some((row) => {
      const detail = JSON.parse(row.detail || "{}");
      return row.action === "dictionary.upsert" && detail.dict_type === "leave_type";
    }),
  "dictionary upsert audited"
);

console.log(`Leave types smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
