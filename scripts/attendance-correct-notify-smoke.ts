import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "attendance-correct-notify-smoke.db")).dbPath
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
const correctMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "考勤已修正"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");

assert(
  app.call(
    "attendance.settings.save",
    {
      work_start_time: "09:00",
      work_end_time: "18:00",
      late_grace_minutes: 0,
    },
    admin
  ).ok,
  "configure attendance settings"
);

const clockIn = app.call("attendance.clock", { kind: "in" }, agentA);
assert(clockIn.ok, "agent_a clocks in");
const attendanceId = data<any>(clockIn).id;
const workDate = data<any[]>(app.call("attendance.list", {}, agentA)).find(
  (row) => row.id === attendanceId
)?.work_date;
assert(Boolean(workDate), "resolve work date");

assert(
  !app.call(
    "attendance.correct",
    {
      id: attendanceId,
      check_in_at: `${workDate}T01:00:00.000Z`,
      check_out_at: `${workDate}T10:00:00.000Z`,
      reason: "",
    },
    manager
  ).ok,
  "correct requires reason"
);
assert(
  !app.call(
    "attendance.correct",
    {
      id: attendanceId,
      check_in_at: `${workDate}T01:00:00.000Z`,
      check_out_at: `${workDate}T10:00:00.000Z`,
      reason: "经纪人不可修正",
    },
    agentB
  ).ok,
  "peer cannot correct"
);

const beforeA = correctMsgs(agentA).length;
const beforeM = correctMsgs(manager).length;
const corrected = app.call(
  "attendance.correct",
  {
    id: attendanceId,
    check_in_at: `${workDate}T02:00:00.000Z`,
    check_out_at: `${workDate}T09:00:00.000Z`,
    reason: "补录门店签到记录",
  },
  manager
);
assert(corrected.ok, "manager corrects attendance");
assert(data<any>(corrected).status === "late_early", "status late_early");
const afterA = correctMsgs(agentA);
assert(afterA.length === beforeA + 1, "employee receives correct message");
assert(afterA[0].ref_id === attendanceId, "message refs attendance");
assert(String(afterA[0].body).includes(workDate), "body has work date");
assert(String(afterA[0].body).includes("late_early"), "body has status");
assert(String(afterA[0].body).includes("补录门店签到记录"), "body has reason");
assert(correctMsgs(manager).length === beforeM, "corrector does not self-notify");

assert(
  app.call("attendance.clock", { kind: "in" }, agentB).ok,
  "agent_b clocks in"
);
const bId = data<any[]>(app.call("attendance.list", {}, agentB))[0].id;
const bDate = data<any[]>(app.call("attendance.list", {}, agentB))[0].work_date;
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agentB).ok,
  "mute other channel"
);
const beforeMute = correctMsgs(agentB).length;
assert(
  app.call(
    "attendance.correct",
    {
      id: bId,
      check_in_at: `${bDate}T01:05:00.000Z`,
      check_out_at: `${bDate}T10:05:00.000Z`,
      reason: "静音修正",
    },
    manager
  ).ok,
  "correct while muted"
);
assert(correctMsgs(agentB).length === beforeMute, "muted other suppresses correct message");

console.log(
  `Attendance correct notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
