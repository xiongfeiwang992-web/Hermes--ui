import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "password-policy-smoke.db")).dbPath);
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
const login = (account: string, password = "123456") => {
  const result = app.call("auth.login", { account, password });
  assert(result.ok, `${account} login`);
  return result.ok ? data<any>(result) : null;
};

const adminLogin = login("admin");
const admin = adminLogin?.token || "";
const defaults = data<any>(app.call("config.settings.get", {}, admin));
assert(defaults.password_max_age_days === 0, "default max age disabled");

assert(
  !app.call(
    "config.settings.save",
    {
      house_hold_limit: defaults.house_hold_limit,
      manager_award_rate: defaults.manager_award_rate,
      password_min_length: defaults.password_min_length,
      password_max_age_days: 800,
    },
    admin
  ).ok,
  "reject password_max_age_days above 730"
);

assert(
  app.call(
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
      password_max_age_days: 30,
    },
    admin
  ).ok,
  "enable 30-day password max age"
);

const fresh = login("agent_a");
assert(fresh && fresh.must_change_password === false, "fresh password not expired");
const agent = fresh?.token || "";
assert(app.call("house.list", {}, agent).ok, "agent can list before expiry");

app.db
  .prepare(`UPDATE users SET password_changed_at = ? WHERE account = ?`)
  .run("2020-01-01T00:00:00.000Z", "agent_a");

const expiredLogin = login("agent_a");
assert(expiredLogin && expiredLogin.must_change_password === true, "login flags must_change_password");
const expired = expiredLogin?.token || "";

const me = app.call("auth.me", {}, expired);
assert(me.ok && data<any>(me).must_change_password === true, "auth.me flags expiry");
assert(
  !app.call("house.list", {}, expired).ok &&
    app.call("house.list", {}, expired).message.includes("密码已过期"),
  "expired agent blocked from business APIs"
);
assert(app.call("auth.logout", {}, expired).ok, "expired agent may logout");

const expiredAgain = login("agent_a")?.token || "";
assert(
  !app.call(
    "auth.changePassword",
    { current_password: "123456", new_password: "short" },
    expiredAgain
  ).ok,
  "reject short new password under policy"
);
const changed = app.call(
  "auth.changePassword",
  { current_password: "123456", new_password: "new-pass-123" },
  expiredAgain
);
assert(changed.ok, "change expired password");
assert(!app.call("auth.me", {}, expiredAgain).ok, "old session invalidated after change");

const renewed = login("agent_a", "new-pass-123");
assert(renewed && renewed.must_change_password === false, "renewed login not expired");
assert(app.call("house.list", {}, renewed?.token || "").ok, "agent business access restored");

const preserved = data<any>(
  app.call(
    "config.settings.save",
    {
      house_hold_limit: defaults.house_hold_limit,
      manager_award_rate: defaults.manager_award_rate,
      password_min_length: defaults.password_min_length,
      deal_required_fields: defaults.deal_required_fields || [],
    },
    admin
  )
);
assert(preserved.password_max_age_days === 30, "omit max age keeps previous value");

console.log(`Password policy smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
