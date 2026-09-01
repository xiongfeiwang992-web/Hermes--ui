import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "attendance-settings-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "考勤参数已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "attendance.settings.save",
    { work_start_time: "09:00", work_end_time: "18:00", late_grace_minutes: 10 },
    manager
  ).ok,
  "manager cannot save attendance settings"
);

const beforeAdmin = settingsMsgs(admin).length;
const beforeManager = settingsMsgs(manager).length;
const beforeAgent = settingsMsgs(agent).length;
const saved = app.call(
  "attendance.settings.save",
  { work_start_time: "09:30", work_end_time: "18:30", late_grace_minutes: 15 },
  admin
);
assert(saved.ok, "admin saves attendance settings");
assert(settingsMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(
  settingsMsgs(manager).length === beforeManager + 1,
  "manager receives settings message"
);
assert(settingsMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  settingsMsgs(manager).some(
    (m) =>
      m.ref_type === "attendance_settings" &&
      String(m.body).includes("09:30-18:30") &&
      String(m.body).includes("宽限 15 分钟")
  ),
  "settings message body"
);

const beforeSecond = settingsMsgs(manager).length;
assert(
  app.call(
    "attendance.settings.save",
    { work_start_time: "09:00", work_end_time: "18:00", late_grace_minutes: 10 },
    admin
  ).ok,
  "admin saves again"
);
assert(settingsMsgs(manager).length === beforeSecond + 1, "each save notifies");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = settingsMsgs(manager).length;
assert(
  app.call(
    "attendance.settings.save",
    { work_start_time: "10:00", work_end_time: "19:00", late_grace_minutes: 5 },
    admin
  ).ok,
  "save while muted"
);
assert(settingsMsgs(manager).length === beforeMute, "muted other suppresses message");

console.log(`Attendance settings notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
