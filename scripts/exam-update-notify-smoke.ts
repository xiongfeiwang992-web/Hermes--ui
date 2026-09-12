import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "exam-update-notify-smoke.db")).dbPath
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
const updateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "考试草稿已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const created = app.call(
  "officeCollab.exams.save",
  { title: "合规考试更新通知", pass_score: 60, duration_minutes: 30 },
  manager
);
assert(created.ok, "manager creates exam draft");
const examId = data<any>(created).id;

assert(
  !app.call(
    "officeCollab.exams.save",
    {
      id: examId,
      title: "经纪人不可改考试",
      pass_score: 60,
      duration_minutes: 30,
    },
    agent
  ).ok,
  "agent cannot update exam"
);

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "officeCollab.exams.save",
  {
    id: examId,
    title: "合规考试更新通知改",
    pass_score: 70,
    duration_minutes: 40,
  },
  manager
);
assert(updated.ok, "manager updates exam draft");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives update message");
assert(updateMsgs(manager).length === beforeManager, "manager actor skips self");
assert(updateMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  updateMsgs(admin).some(
    (m) =>
      m.ref_id === examId &&
      m.ref_type === "office_exam" &&
      String(m.body).includes("合规考试更新通知改")
  ),
  "update message body"
);

const beforeSelfAdmin = updateMsgs(admin).length;
const beforeSelfMgr = updateMsgs(manager).length;
assert(
  app.call(
    "officeCollab.exams.save",
    {
      id: examId,
      title: "管理员改考试",
      pass_score: 75,
      duration_minutes: 45,
    },
    admin
  ).ok,
  "admin updates exam"
);
assert(updateMsgs(admin).length === beforeSelfAdmin, "admin actor skips self");
assert(updateMsgs(manager).length === beforeSelfMgr + 1, "manager receives admin update");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, admin).ok,
  "mute other"
);
const beforeMute = updateMsgs(admin).length;
assert(
  app.call(
    "officeCollab.exams.save",
    {
      id: examId,
      title: "静音考试更新",
      pass_score: 50,
      duration_minutes: 20,
    },
    manager
  ).ok,
  "update while muted"
);
assert(updateMsgs(admin).length === beforeMute, "muted other suppresses update message");

console.log(`Exam update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
