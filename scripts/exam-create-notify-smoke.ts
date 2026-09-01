import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "exam-create-notify-smoke.db")).dbPath
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
const draftMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "考试草稿已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "officeCollab.exams.save",
    { title: "经纪人不可建考试", pass_score: 60, duration_minutes: 30 },
    agent
  ).ok,
  "agent cannot create exam"
);

const beforeAdmin = draftMsgs(admin).length;
const beforeManager = draftMsgs(manager).length;
const beforeAgent = draftMsgs(agent).length;
const created = app.call(
  "officeCollab.exams.save",
  { title: "合规考试草稿通知", pass_score: 60, duration_minutes: 30 },
  manager
);
assert(created.ok, "manager creates exam draft");
const examId = data<any>(created).id;
assert(draftMsgs(admin).length === beforeAdmin + 1, "admin receives draft message");
assert(draftMsgs(manager).length === beforeManager, "manager actor skips self");
assert(draftMsgs(agent).length === beforeAgent, "agent not notified on draft create");
assert(
  draftMsgs(admin).some(
    (m) =>
      m.ref_id === examId &&
      m.ref_type === "office_exam" &&
      String(m.body).includes("合规考试草稿通知")
  ),
  "draft message body refs exam"
);

const beforeUpdate = draftMsgs(admin).length;
assert(
  app.call(
    "officeCollab.exams.save",
    {
      id: examId,
      title: "合规考试草稿通知改",
      pass_score: 70,
      duration_minutes: 40,
    },
    manager
  ).ok,
  "manager updates exam draft"
);
assert(draftMsgs(admin).length === beforeUpdate, "update does not re-notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, admin).ok,
  "mute other"
);
const beforeMute = draftMsgs(admin).length;
assert(
  app.call(
    "officeCollab.exams.save",
    { title: "静音考试草稿", pass_score: 50, duration_minutes: 20 },
    manager
  ).ok,
  "create while muted"
);
assert(draftMsgs(admin).length === beforeMute, "muted other suppresses draft message");

console.log(`Exam create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
