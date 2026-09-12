import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "job-grade-assign-notify-smoke.db")).dbPath
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
const gradeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "职级已调整"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const gradeA = app.call(
  "workforce.grades.save",
  {
    code: "GA1",
    name: "定级通知初级",
    rank_level: 1,
    applicable_role: "agent",
  },
  admin
);
assert(gradeA.ok, "create grade A1");
const gradeAId = data<any>(gradeA).id;
const gradeB = app.call(
  "workforce.grades.save",
  {
    code: "GA2",
    name: "定级通知中级",
    rank_level: 2,
    applicable_role: "agent",
  },
  admin
);
assert(gradeB.ok, "create grade A2");
const gradeBId = data<any>(gradeB).id;

assert(
  !app.call(
    "workforce.grades.assign",
    { user_id: agentAId, job_grade_id: gradeAId, reason: "" },
    admin
  ).ok,
  "assign requires reason"
);
assert(
  !app.call(
    "workforce.grades.assign",
    { user_id: agentAId, job_grade_id: gradeAId, reason: "店长不可定级" },
    manager
  ).ok,
  "manager cannot assign grade"
);

const beforeA = gradeMsgs(agentA).length;
const beforeAdmin = gradeMsgs(admin).length;
const assigned = app.call(
  "workforce.grades.assign",
  { user_id: agentAId, job_grade_id: gradeAId, reason: "入职定级" },
  admin
);
assert(assigned.ok, "admin assigns grade to agent_a");
const afterA = gradeMsgs(agentA);
assert(afterA.length === beforeA + 1, "employee receives grade message");
assert(afterA[0].ref_id === gradeAId, "message refs grade");
assert(String(afterA[0].body).includes("定级通知初级"), "body has grade name");
assert(String(afterA[0].body).includes("GA1"), "body has grade code");
assert(String(afterA[0].body).includes("入职定级"), "body has reason");
assert(gradeMsgs(admin).length === beforeAdmin, "admin does not self-notify");

const beforeRe = gradeMsgs(agentA).length;
assert(
  app.call(
    "workforce.grades.assign",
    { user_id: agentAId, job_grade_id: gradeBId, reason: "考核晋级" },
    admin
  ).ok,
  "admin reassigns higher grade"
);
assert(gradeMsgs(agentA).length === beforeRe + 1, "reassign notifies again");
assert(
  gradeMsgs(agentA).some(
    (m) => m.ref_id === gradeBId && String(m.body).includes("考核晋级")
  ),
  "reassign message has new grade and reason"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agentB).ok,
  "mute other channel"
);
const beforeMute = gradeMsgs(agentB).length;
assert(
  app.call(
    "workforce.grades.assign",
    { user_id: agentBId, job_grade_id: gradeAId, reason: "静音定级" },
    admin
  ).ok,
  "assign while muted"
);
assert(gradeMsgs(agentB).length === beforeMute, "muted other suppresses grade message");

console.log(`Job grade assign notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
