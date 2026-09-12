import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "attendance-late-notify-smoke.db")).dbPath
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
const lateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "考勤异常提醒"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

assert(
  app.call(
    "attendance.settings.save",
    {
      work_start_time: "00:00",
      work_end_time: "23:59",
      late_grace_minutes: 0,
    },
    admin
  ).ok,
  "force any check-in late"
);

const beforeAdmin = lateMsgs(admin).length;
const beforeManager = lateMsgs(manager).length;
const beforeAgent = lateMsgs(agent).length;
const clocked = app.call("attendance.clock", { kind: "in" }, agent);
assert(clocked.ok, "agent clocks in late");
assert(data<any>(clocked).status === "late", "status is late");
const attendanceId = data<any>(clocked).id;
assert(lateMsgs(admin).length === beforeAdmin + 1, "admin receives late message");
assert(lateMsgs(manager).length === beforeManager + 1, "manager receives late message");
assert(lateMsgs(agent).length === beforeAgent, "employee does not self-notify");
assert(
  lateMsgs(manager).some(
    (m) =>
      m.ref_id === attendanceId &&
      String(m.body).includes("迟到") &&
      String(m.body).includes(agentName)
  ),
  "late message body"
);

const beforeSelfMgr = lateMsgs(manager).length;
const beforeSelfAdmin = lateMsgs(admin).length;
const mgrClock = app.call("attendance.clock", { kind: "in" }, manager);
assert(mgrClock.ok, "manager clocks in late");
assert(data<any>(mgrClock).status === "late", "manager status late");
assert(lateMsgs(manager).length === beforeSelfMgr, "manager actor skips self");
assert(lateMsgs(admin).length === beforeSelfAdmin + 1, "admin still notified for manager late");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, admin).ok,
  "mute other"
);
const beforeMuteAdmin = lateMsgs(admin).length;
const beforeMuteMgr = lateMsgs(manager).length;
const peerClock = app.call("attendance.clock", { kind: "in" }, peer);
assert(peerClock.ok, "peer clocks in late");
assert(data<any>(peerClock).status === "late", "peer status late");
assert(lateMsgs(admin).length === beforeMuteAdmin, "muted other suppresses late message");
assert(
  lateMsgs(manager).length === beforeMuteMgr + 1,
  "manager still receives peer late when admin muted"
);
assert(
  lateMsgs(manager).some((m) => m.ref_id === data<any>(peerClock).id),
  "manager message refs peer attendance"
);

console.log(`Attendance late notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
