import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "system-settings-smoke.db")).dbPath);
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

const defaults = data<any>(app.call("config.settings.get", {}, admin));
assert(defaults.agent_pool_rate === 0.5, "default agent_pool_rate 0.5");
assert(defaults.public_pool_days === 0, "default public_pool_days 0");
assert(defaults.public_pool_enabled === false, "default public pool disabled");

assert(
  app.call("config.settings.get", {}, manager).ok,
  "store manager can read settings"
);
assert(
  !app.call("config.settings.get", {}, agent).ok,
  "agent cannot read settings"
);

assert(
  !app.call(
    "config.settings.save",
    {
      house_hold_limit: defaults.house_hold_limit,
      manager_award_rate: defaults.manager_award_rate,
      password_min_length: defaults.password_min_length,
      agent_pool_rate: 1.2,
    },
    admin
  ).ok,
  "reject agent_pool_rate above 1"
);

assert(
  !app.call(
    "config.settings.save",
    {
      house_hold_limit: defaults.house_hold_limit,
      manager_award_rate: defaults.manager_award_rate,
      password_min_length: defaults.password_min_length,
      public_pool_days: 400,
    },
    admin
  ).ok,
  "reject public_pool_days above 365"
);

assert(
  !app.call(
    "config.settings.save",
    {
      house_hold_limit: defaults.house_hold_limit,
      manager_award_rate: defaults.manager_award_rate,
      password_min_length: defaults.password_min_length,
      agent_pool_rate: 0.6,
      public_pool_days: 21,
    },
    manager
  ).ok,
  "store manager cannot save settings"
);

const saved = app.call(
  "config.settings.save",
  {
    house_hold_limit: defaults.house_hold_limit,
    manager_award_rate: defaults.manager_award_rate,
    password_min_length: defaults.password_min_length,
    house_role_protection_days: defaults.house_role_protection_days,
    deal_doc_required: !!defaults.deal_doc_required,
    force_follow_before_phone: !!defaults.force_follow_before_phone,
    non_holder_view_remind: !!defaults.non_holder_view_remind,
    deal_required_fields: defaults.deal_required_fields || [],
    agent_pool_rate: 0.6,
    public_pool_days: 21,
  },
  admin
);
assert(saved.ok, "admin saves system params");
const after = data<any>(saved);
assert(after.agent_pool_rate === 0.6, "saved agent_pool_rate");
assert(after.public_pool_days === 21, "saved public_pool_days");
assert(after.public_pool_enabled === true, "public_pool_enabled true when days>0");

const poolView = data<any>(app.call("customer.publicPool.settings", {}, admin));
assert(poolView.public_pool_days === 21, "publicPool.settings mirrors system param");
assert(poolView.enabled === true, "publicPool.settings enabled");

const preserved = app.call(
  "config.settings.save",
  {
    house_hold_limit: defaults.house_hold_limit,
    manager_award_rate: 0.08,
    password_min_length: defaults.password_min_length,
    deal_required_fields: ["loan_bank"],
  },
  admin
);
assert(preserved.ok, "partial save without pool fields");
const kept = data<any>(preserved);
assert(kept.agent_pool_rate === 0.6, "omit agent_pool_rate keeps previous");
assert(kept.public_pool_days === 21, "omit public_pool_days keeps previous");
assert(kept.manager_award_rate === 0.08, "manager_award_rate updated");
assert(
  Array.isArray(kept.deal_required_fields) && kept.deal_required_fields.includes("loan_bank"),
  "deal_required_fields updated"
);

const viaPoolApi = app.call("customer.publicPool.update", { public_pool_days: 7 }, admin);
assert(viaPoolApi.ok, "legacy publicPool.update still works");
const synced = data<any>(app.call("config.settings.get", {}, admin));
assert(synced.public_pool_days === 7, "publicPool.update syncs into settings.get");

console.log(`System settings smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
