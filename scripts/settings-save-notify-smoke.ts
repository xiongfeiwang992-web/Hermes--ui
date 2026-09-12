import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "settings-save-notify-smoke.db")).dbPath
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
const settingsMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "业务参数已更新"
  );
const basePayload = {
  house_hold_limit: 20,
  manager_award_rate: 0.1,
  password_min_length: 8,
  deal_required_fields: [],
  deal_doc_required: false,
  house_role_protection_days: 30,
  force_follow_before_phone: false,
  non_holder_view_remind: true,
};

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call("config.settings.save", basePayload, manager).ok,
  "manager cannot save settings"
);

const beforeAdmin = settingsMsgs(admin).length;
const beforeManager = settingsMsgs(manager).length;
const beforeAgent = settingsMsgs(agent).length;
const saved = app.call(
  "config.settings.save",
  { ...basePayload, house_hold_limit: 25, manager_award_rate: 0.12 },
  admin
);
assert(saved.ok, "admin saves settings");
assert(settingsMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(
  settingsMsgs(manager).length === beforeManager + 1,
  "manager receives settings message"
);
assert(settingsMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  settingsMsgs(manager).some(
    (m) =>
      m.ref_type === "settings" &&
      String(m.body).includes("持盘上限 25") &&
      String(m.body).includes("管理奖 0.12") &&
      String(m.body).includes("密码最短 8") &&
      String(m.body).includes("角色保护 30 天")
  ),
  "settings message body"
);

const beforeSecond = settingsMsgs(manager).length;
assert(
  app.call(
    "config.settings.save",
    { ...basePayload, house_hold_limit: 18, house_role_protection_days: 45 },
    admin
  ).ok,
  "admin saves settings again"
);
assert(
  settingsMsgs(manager).length === beforeSecond + 1,
  "each save notifies manager"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = settingsMsgs(manager).length;
assert(
  app.call(
    "config.settings.save",
    { ...basePayload, house_hold_limit: 22 },
    admin
  ).ok,
  "save while muted"
);
assert(settingsMsgs(manager).length === beforeMute, "muted other suppresses message");

console.log(`Settings save notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
