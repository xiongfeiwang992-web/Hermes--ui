import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "exam-publish-notify-smoke.db")).dbPath
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
const publishMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "考试已发布"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const cross = login("agent_c");
const finance = login("finance");

const exam = app.call(
  "officeCollab.exams.save",
  { title: "发布通知合规考试", pass_score: 60, duration_minutes: 30 },
  manager
);
assert(exam.ok, "manager creates store exam");
const examId = data<any>(exam).id;

assert(
  !app.call("officeCollab.exams.publish", { id: examId }, agent).ok,
  "agent cannot publish exam"
);

const beforeAgent = publishMsgs(agent).length;
const beforePeer = publishMsgs(peer).length;
const beforeManager = publishMsgs(manager).length;
const beforeAdmin = publishMsgs(admin).length;
const beforeCross = publishMsgs(cross).length;
const beforeFinance = publishMsgs(finance).length;

const published = app.call("officeCollab.exams.publish", { id: examId }, manager);
assert(published.ok, "manager publishes exam");
assert(data<any>(published).status === "published", "status published");

assert(publishMsgs(agent).length === beforeAgent + 1, "store agent notified");
assert(publishMsgs(peer).length === beforePeer + 1, "store peer notified");
assert(
  publishMsgs(agent).some(
    (m) => m.ref_id === examId && String(m.body).includes("发布通知合规考试")
  ),
  "message refs exam with title"
);
assert(publishMsgs(manager).length === beforeManager, "publisher does not self-notify");
assert(publishMsgs(admin).length === beforeAdmin + 1, "admin notified for store exam");
assert(publishMsgs(cross).length === beforeCross, "cross-store agent not notified");
assert(publishMsgs(finance).length === beforeFinance, "finance not notified");
assert(
  !app.call("officeCollab.exams.publish", { id: examId }, manager).ok,
  "cannot publish twice"
);

const mutedExam = app.call(
  "officeCollab.exams.save",
  { title: "静音发布考试", pass_score: 70, duration_minutes: 20 },
  manager
);
assert(mutedExam.ok, "create muted exam");
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other channel"
);
const beforeMute = publishMsgs(agent).length;
assert(
  app.call("officeCollab.exams.publish", { id: data<any>(mutedExam).id }, manager).ok,
  "publish while agent muted"
);
assert(publishMsgs(agent).length === beforeMute, "muted other suppresses exam message");

console.log(`Exam publish notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
