import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "exam-attempt-notify-smoke.db")).dbPath
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
const attemptMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "business_record_status" &&
      (m.title === "考试已通过" || m.title === "考试已提交")
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

function prepareExam(title: string, passScore = 60) {
  const exam = app.call(
    "officeCollab.exams.save",
    { title, pass_score: passScore, duration_minutes: 30 },
    manager
  );
  assert(exam.ok, `create ${title}`);
  const examId = data<any>(exam).id;
  assert(
    app.call("officeCollab.exams.publish", { id: examId }, manager).ok,
    `publish ${title}`
  );
  return examId;
}

const passExamId = prepareExam("及格通知考试");
const beforeManager = attemptMsgs(manager).length;
const beforeAgent = attemptMsgs(agent).length;
const passedAttempt = app.call(
  "officeCollab.exams.attempt",
  { exam_id: passExamId, score: 85 },
  agent
);
assert(passedAttempt.ok, "agent submits passing score");
assert(data<any>(passedAttempt).passed === true, "passed true");
assert(attemptMsgs(manager).length === beforeManager + 1, "creator receives attempt message");
assert(attemptMsgs(agent).length === beforeAgent, "examinee does not self-notify");
assert(
  attemptMsgs(manager).some(
    (m) =>
      m.ref_type === "office_exam_attempt" &&
      m.title === "考试已通过" &&
      String(m.body).includes("及格通知考试") &&
      String(m.body).includes(agentName) &&
      String(m.body).includes("85")
  ),
  "pass message body"
);
assert(
  !app.call("officeCollab.exams.attempt", { exam_id: passExamId, score: 90 }, agent).ok,
  "duplicate attempt blocked"
);

const failExamId = prepareExam("未及格通知考试", 80);
const beforeFail = attemptMsgs(manager).length;
assert(
  app.call("officeCollab.exams.attempt", { exam_id: failExamId, score: 50 }, peer).ok,
  "peer submits failing score"
);
assert(
  attemptMsgs(manager).some(
    (m) => String(m.body).includes("未及格通知考试") && m.title === "考试已提交"
  ),
  "fail title is 考试已提交"
);
assert(attemptMsgs(manager).length === beforeFail + 1, "fail notifies once");

const mutedExamId = prepareExam("静音考试通知");
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other channel"
);
const beforeMute = attemptMsgs(manager).length;
assert(
  app.call("officeCollab.exams.attempt", { exam_id: mutedExamId, score: 70 }, agent).ok,
  "attempt while muted"
);
assert(attemptMsgs(manager).length === beforeMute, "muted other suppresses attempt message");

console.log(`Exam attempt notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
