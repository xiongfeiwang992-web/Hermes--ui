import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "attendance-smoke.db")).dbPath);
let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentC = login("agent_c");

const defaultSettings = app.call("attendance.settings.get", {}, agentA);
check(
  defaultSettings.ok &&
    data<any>(defaultSettings).work_start_time === "09:00" &&
    data<any>(defaultSettings).work_end_time === "18:00",
  "default attendance settings"
);
check(
  !app.call(
    "attendance.settings.save",
    { work_start_time: "09:00", work_end_time: "18:00", late_grace_minutes: 10 },
    finance
  ).ok,
  "only admin can change attendance settings"
);
check(
  !app.call(
    "attendance.settings.save",
    { work_start_time: "18:00", work_end_time: "09:00", late_grace_minutes: 10 },
    admin
  ).ok,
  "reject invalid work schedule"
);
check(
  app.call(
    "attendance.settings.save",
    { work_start_time: "09:00", work_end_time: "18:00", late_grace_minutes: 15 },
    admin
  ).ok,
  "admin saves attendance settings"
);
check(
  !app.call("attendance.clock", { kind: "out" }, agentA).ok,
  "cannot clock out before clock in"
);
const clockIn = app.call("attendance.clock", { kind: "in" }, agentA);
check(clockIn.ok && data<any>(clockIn).kind === "in", "employee clocks in");
check(
  !app.call("attendance.clock", { kind: "in" }, agentA).ok,
  "duplicate clock in rejected"
);
const ownAttendance = app.call("attendance.list", {}, agentA);
check(
  ownAttendance.ok && data<any[]>(ownAttendance).length === 1,
  "employee lists own attendance"
);
const attendanceId = data<any[]>(ownAttendance)[0].id;
const workDate = data<any[]>(ownAttendance)[0].work_date;
check(
  data<any[]>(app.call("attendance.list", {}, agentB)).length === 0,
  "employee cannot see coworker attendance"
);
check(
  data<any[]>(app.call("attendance.list", {}, manager)).some(
    (record) => record.id === attendanceId
  ),
  "manager sees same-store attendance"
);
check(
  !app.call(
    "attendance.correct",
    {
      id: attendanceId,
      check_in_at: `${workDate}T02:00:00.000Z`,
      check_out_at: `${workDate}T09:00:00.000Z`,
      reason: "",
    },
    manager
  ).ok,
  "attendance correction requires reason"
);
check(
  !app.call(
    "attendance.correct",
    {
      id: attendanceId,
      check_in_at: `${workDate}T09:00:00.000Z`,
      check_out_at: `${workDate}T02:00:00.000Z`,
      reason: "顺序错误",
    },
    manager
  ).ok,
  "reject invalid correction times"
);
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
check(
  corrected.ok && data<any>(corrected).status === "late_early",
  "manager corrects attendance and recalculates exception"
);
check(
  !app.call("attendance.clock", { kind: "out" }, agentA).ok,
  "corrected checkout prevents duplicate clock out"
);
check(app.call("attendance.clock", { kind: "in" }, agentB).ok, "second employee clocks in");
check(app.call("attendance.clock", { kind: "out" }, agentB).ok, "second employee clocks out");
check(
  !app.call("attendance.clock", { kind: "invalid" }, agentB).ok,
  "reject invalid clock type"
);

check(
  !app.call(
    "leave.create",
    {
      leave_type: "invalid",
      start_at: "2026-09-01T09:00:00.000Z",
      end_at: "2026-09-01T18:00:00.000Z",
      reason: "无效类型",
    },
    agentA
  ).ok,
  "reject invalid leave type"
);
check(
  !app.call(
    "leave.create",
    {
      leave_type: "annual",
      start_at: "2026-09-01T18:00:00.000Z",
      end_at: "2026-09-01T09:00:00.000Z",
      reason: "无效时间",
    },
    agentA
  ).ok,
  "reject invalid leave range"
);
const leave = app.call(
  "leave.create",
  {
    leave_type: "annual",
    start_at: "2026-09-01T09:00:00.000Z",
    end_at: "2026-09-01T17:00:00.000Z",
    reason: "办理家庭事务",
  },
  agentA
);
check(
  leave.ok &&
    data<any>(leave).status === "pending" &&
    data<any>(leave).duration_hours === 8,
  "employee submits calculated leave request"
);
const leaveId = data<any>(leave).id;
check(
  !app.call(
    "leave.create",
    {
      leave_type: "personal",
      start_at: "2026-09-01T12:00:00.000Z",
      end_at: "2026-09-01T18:00:00.000Z",
      reason: "重叠申请",
    },
    agentA
  ).ok,
  "prevent overlapping active leave"
);
check(
  data<any[]>(app.call("leave.list", {}, agentB)).length === 0,
  "employee cannot see coworker leave"
);
check(
  data<any[]>(app.call("leave.list", {}, manager)).some(
    (request) => request.id === leaveId
  ),
  "manager sees same-store leave"
);
check(
  !app.call(
    "leave.review",
    { id: leaveId, status: "approved" },
    finance
  ).ok,
  "finance cannot approve leave"
);
check(
  app.call(
    "leave.review",
    { id: leaveId, status: "approved" },
    manager
  ).ok,
  "manager approves employee leave"
);
check(
  !app.call(
    "leave.review",
    { id: leaveId, status: "approved" },
    manager
  ).ok,
  "approved leave cannot be reviewed twice"
);
check(
  !app.call("leave.cancel", { id: leaveId }, agentA).ok,
  "approved leave cannot be cancelled directly"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.kind === "leave_review"
  ),
  "applicant receives leave review message"
);
check(
  data<any[]>(app.call("message.list", {}, manager)).some(
    (message) => message.kind === "leave_pending"
  ),
  "manager receives pending leave message"
);

const managerLeave = app.call(
  "leave.create",
  {
    leave_type: "sick",
    start_at: "2026-09-02T09:00:00.000Z",
    end_at: "2026-09-02T12:00:00.000Z",
    reason: "门诊复查",
  },
  manager
);
check(managerLeave.ok, "manager submits own leave");
check(
  !app.call(
    "leave.review",
    { id: data<any>(managerLeave).id, status: "approved" },
    manager
  ).ok,
  "manager cannot self-approve leave"
);
check(
  app.call(
    "leave.review",
    { id: data<any>(managerLeave).id, status: "approved" },
    admin
  ).ok,
  "admin approves manager leave"
);

const crossStoreLeave = app.call(
  "leave.create",
  {
    leave_type: "personal",
    start_at: "2026-09-03T09:00:00.000Z",
    end_at: "2026-09-03T11:00:00.000Z",
    reason: "二号店员工请假",
  },
  agentC
);
check(crossStoreLeave.ok, "cross-store employee submits leave");
check(
  !data<any[]>(app.call("leave.list", {}, manager)).some(
    (request) => request.id === data<any>(crossStoreLeave).id
  ),
  "manager cannot see another store leave"
);
check(
  !app.call(
    "leave.review",
    { id: data<any>(crossStoreLeave).id, status: "rejected", reason: "" },
    admin
  ).ok,
  "leave rejection requires reason"
);
check(
  app.call(
    "leave.review",
    {
      id: data<any>(crossStoreLeave).id,
      status: "rejected",
      reason: "请补充证明",
    },
    admin
  ).ok,
  "admin rejects cross-store leave with reason"
);

const cancellable = app.call(
  "leave.create",
  {
    leave_type: "other",
    start_at: "2026-09-04T09:00:00.000Z",
    end_at: "2026-09-04T10:00:00.000Z",
    reason: "临时外出",
  },
  agentB
);
check(cancellable.ok, "create cancellable pending leave");
check(
  !app.call("leave.cancel", { id: data<any>(cancellable).id }, agentA).ok,
  "other employee cannot cancel leave"
);
check(
  app.call("leave.cancel", { id: data<any>(cancellable).id }, agentB).ok,
  "applicant cancels pending leave"
);
check(
  app.call(
    "leave.create",
    {
      leave_type: "other",
      start_at: "2026-09-04T09:00:00.000Z",
      end_at: "2026-09-04T10:00:00.000Z",
      reason: "取消后重新申请",
    },
    agentB
  ).ok,
  "cancelled interval can be requested again"
);

console.log(`Attendance smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
