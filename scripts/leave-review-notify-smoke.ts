import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "leave-review-notify-smoke.db")).dbPath
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
const reviewMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "leave_review" &&
      (m.title === "请假申请已通过" || m.title === "请假申请已驳回")
  );
const approvedMsgs = (token: string) =>
  reviewMsgs(token).filter((m) => m.title === "请假申请已通过");
const rejectedMsgs = (token: string) =>
  reviewMsgs(token).filter((m) => m.title === "请假申请已驳回");

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

function createPending(token: string, reason: string, leaveType = "personal") {
  const created = app.call(
    "leave.create",
    {
      leave_type: leaveType,
      start_at: `2026-12-0${createPending.n}T01:00:00.000Z`,
      end_at: `2026-12-0${createPending.n}T05:00:00.000Z`,
      reason,
    },
    token
  );
  createPending.n += 1;
  assert(created.ok, `create leave ${reason}`);
  return data<any>(created).id;
}
createPending.n = 1;

assert(
  !app.call("leave.review", { id: "missing", status: "approved" }, manager).ok,
  "cannot review missing leave"
);

const approveId = createPending(agent, "审批通过通知测试", "sick");
assert(
  !app.call("leave.review", { id: approveId, status: "approved" }, agent).ok,
  "applicant cannot self-review"
);
assert(
  !app.call("leave.review", { id: approveId, status: "approved" }, peer).ok,
  "peer agent cannot review"
);

const beforeAgent = approvedMsgs(agent).length;
const beforeManager = approvedMsgs(manager).length;
const approved = app.call(
  "leave.review",
  { id: approveId, status: "approved" },
  manager
);
assert(approved.ok, "manager approves leave");
assert(data<any>(approved).status === "approved", "status approved");
assert(approvedMsgs(agent).length === beforeAgent + 1, "applicant receives approved");
assert(approvedMsgs(manager).length === beforeManager, "reviewer skips self");
assert(
  approvedMsgs(agent).some(
    (m) =>
      m.ref_id === approveId &&
      m.ref_type === "leave_request" &&
      String(m.body).includes("病假") &&
      String(m.body).includes("4")
  ),
  "approved message body"
);

const rejectId = createPending(agent, "审批驳回通知测试", "annual");
assert(
  !app.call("leave.review", { id: rejectId, status: "rejected" }, manager).ok,
  "reject requires reason"
);
const beforeReject = rejectedMsgs(agent).length;
const rejected = app.call(
  "leave.review",
  { id: rejectId, status: "rejected", reason: "人手不足驳回" },
  manager
);
assert(rejected.ok, "manager rejects leave");
assert(rejectedMsgs(agent).length === beforeReject + 1, "applicant receives rejected");
assert(
  rejectedMsgs(agent).some(
    (m) => m.ref_id === rejectId && String(m.body).includes("人手不足驳回")
  ),
  "rejected message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, agent).ok,
  "mute hr"
);
const muteId = createPending(agent, "静音审批通知测试", "personal");
const beforeMute = reviewMsgs(agent).length;
assert(
  app.call("leave.review", { id: muteId, status: "approved" }, manager).ok,
  "approve while muted"
);
assert(reviewMsgs(agent).length === beforeMute, "muted hr suppresses review message");

console.log(`Leave review notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
