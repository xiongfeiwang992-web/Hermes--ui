import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "leave-cancel-notify-smoke.db")).dbPath);
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
const cancelMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "leave_review" && m.title === "请假申请已取消"
  );

const agentA = login("agent_a");
const agentB = login("agent_b");
const manager = login("manager");

const leave = app.call(
  "leave.create",
  {
    leave_type: "personal",
    start_at: "2026-10-01T09:00:00.000Z",
    end_at: "2026-10-01T12:00:00.000Z",
    reason: "取消通知测试",
  },
  agentA
);
assert(leave.ok, "agent creates pending leave");
const leaveId = data<any>(leave).id;
assert(data<any>(leave).duration_hours === 3, "duration hours computed");

const beforeManager = cancelMsgs(manager).length;
const beforeAgent = cancelMsgs(agentA).length;

assert(
  !app.call("leave.cancel", { id: leaveId }, agentB).ok,
  "peer cannot cancel leave"
);

const cancelled = app.call("leave.cancel", { id: leaveId }, agentA);
assert(cancelled.ok, "applicant cancels pending leave");
assert(data<any>(cancelled).status === "cancelled", "status cancelled");

const afterManager = cancelMsgs(manager);
assert(afterManager.length === beforeManager + 1, "manager receives cancel message");
assert(afterManager[0].ref_id === leaveId, "message refs leave request");
assert(String(afterManager[0].body).includes("经纪人甲"), "body has applicant name");
assert(String(afterManager[0].body).includes("3"), "body has hours");
assert(cancelMsgs(agentA).length === beforeAgent, "applicant does not self-notify");

assert(
  !app.call("leave.cancel", { id: leaveId }, agentA).ok,
  "cannot cancel twice"
);

const leave2 = app.call(
  "leave.create",
  {
    leave_type: "other",
    start_at: "2026-10-02T09:00:00.000Z",
    end_at: "2026-10-02T10:00:00.000Z",
    reason: "静音取消测",
  },
  agentA
);
assert(leave2.ok, "create mute-test leave");
assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, manager).ok,
  "mute hr channel for manager"
);
const beforeMute = cancelMsgs(manager).length;
assert(
  app.call("leave.cancel", { id: data<any>(leave2).id }, agentA).ok,
  "cancel while manager muted"
);
assert(cancelMsgs(manager).length === beforeMute, "muted hr suppresses cancel message");

const managerLeave = app.call(
  "leave.create",
  {
    leave_type: "sick",
    start_at: "2026-10-03T09:00:00.000Z",
    end_at: "2026-10-03T11:00:00.000Z",
    reason: "店长自请",
  },
  manager
);
assert(managerLeave.ok, "manager creates own leave");
const beforeSelfMgr = cancelMsgs(manager).length;
assert(
  app.call("leave.cancel", { id: data<any>(managerLeave).id }, manager).ok,
  "manager cancels own leave"
);
assert(
  cancelMsgs(manager).length === beforeSelfMgr,
  "no store_manager peers means no cancel fan-out to self"
);

console.log(`Leave cancel notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
