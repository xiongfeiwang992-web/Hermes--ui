import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "recruitment-job-close-notify-smoke.db")).dbPath
);
const resumePath = path.resolve("/tmp", "recruitment-job-close-notify-resume.txt");
fs.writeFileSync(resumePath, "recruitment job close notify resume");

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
const closeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "recruitment" && m.title === "招聘岗位已关闭"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");

const options = app.call("recruitment.options", {}, admin);
assert(options.ok, "admin recruitment options");
const storeA = data<any>(options).stores.find((store: any) => store.name === "一号店").id;

const job = app.call(
  "recruitment.jobs.save",
  {
    title: "关闭通知经纪人岗",
    store_id: storeA,
    target_role: "agent",
    headcount: 2,
    requirements: "关闭通知测试",
  },
  manager
);
assert(job.ok, "manager creates open job");
const jobId = data<any>(job).id;

assert(
  !app.call("recruitment.jobs.close", { id: jobId }, agentA).ok,
  "agent cannot close job"
);

const beforeAdmin = closeMsgs(admin).length;
const beforeManager = closeMsgs(manager).length;
const closed = app.call("recruitment.jobs.close", { id: jobId }, manager);
assert(closed.ok, "manager closes job");
assert(data<any>(closed).status === "closed", "status closed");

const afterAdmin = closeMsgs(admin);
assert(afterAdmin.length === beforeAdmin + 1, "admin receives close message");
assert(afterAdmin[0].ref_id === jobId, "message refs job");
assert(String(afterAdmin[0].body).includes("关闭通知经纪人岗"), "body has job title");
assert(String(afterAdmin[0].body).includes("一号店长"), "body has actor name");
assert(closeMsgs(manager).length === beforeManager, "closer does not self-notify");
assert(
  !app.call("recruitment.jobs.close", { id: jobId }, manager).ok,
  "cannot close twice"
);

const job2 = app.call(
  "recruitment.jobs.save",
  {
    title: "管理员关闭岗",
    store_id: storeA,
    target_role: "agent",
    headcount: 1,
  },
  admin
);
assert(job2.ok, "admin creates second job");
const id2 = data<any>(job2).id;
const beforeMgr2 = closeMsgs(manager).length;
const beforeAdmin2 = closeMsgs(admin).length;
assert(
  app.call("recruitment.jobs.close", { id: id2 }, admin).ok,
  "admin closes own job"
);
assert(
  closeMsgs(manager).length === beforeMgr2 + 1,
  "store manager receives when admin closes"
);
assert(closeMsgs(admin).length === beforeAdmin2, "admin actor does not self-notify");

const job3 = app.call(
  "recruitment.jobs.save",
  {
    title: "静音关闭岗",
    store_id: storeA,
    target_role: "agent",
    headcount: 1,
  },
  manager
);
assert(job3.ok, "create mute-test job");
assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, admin).ok,
  "mute hr channel for admin"
);
const beforeMute = closeMsgs(admin).length;
assert(
  app.call("recruitment.jobs.close", { id: data<any>(job3).id }, manager).ok,
  "close while admin muted"
);
assert(closeMsgs(admin).length === beforeMute, "muted hr suppresses close message");

const autoJob = app.call(
  "recruitment.jobs.save",
  {
    title: "满编自动关闭岗",
    store_id: storeA,
    target_role: "agent",
    headcount: 1,
  },
  manager
);
assert(autoJob.ok, "create auto-close job");
const autoJobId = data<any>(autoJob).id;
const candidate = app.call(
  "recruitment.candidates.create",
  {
    job_id: autoJobId,
    name: "满编候选人",
    phone: "13950000991",
    source: "内部推荐",
  },
  manager
);
assert(candidate.ok, "create auto-close candidate");
const candidateId = data<any>(candidate).id;
assert(
  app.call(
    "attachment.add",
    {
      parent_type: "recruitment_candidate",
      parent_id: candidateId,
      category: "resume",
      name: "简历.txt",
      local_path: resumePath,
    },
    manager
  ).ok,
  "upload candidate resume"
);
assert(
  app.call(
    "recruitment.candidates.status",
    {
      id: candidateId,
      status: "screening",
    },
    manager
  ).ok,
  "candidate to screening"
);
assert(
  app.call(
    "recruitment.candidates.status",
    {
      id: candidateId,
      status: "interview",
      interview_at: "2026-09-01T10:00:00.000Z",
    },
    manager
  ).ok,
  "candidate to interview"
);
assert(
  app.call(
    "recruitment.candidates.status",
    { id: candidateId, status: "offer" },
    manager
  ).ok,
  "candidate to offer"
);

assert(
  app.call("message.subscriptions.save", { channels: { hr: true } }, admin).ok,
  "unmute hr for admin"
);
assert(
  app.call("message.subscriptions.save", { channels: { hr: true } }, manager).ok,
  "ensure manager hr enabled"
);
const beforeAutoManager = closeMsgs(manager).length;
const beforeAutoAdmin = closeMsgs(admin).length;
const onboarded = app.call(
  "recruitment.candidates.onboard",
  {
    id: candidateId,
    account: "hired_close_notify",
    display_name: "满编入职",
    password: "candidate-pass",
  },
  admin
);
assert(onboarded.ok && data<any>(onboarded).status === "hired", "admin onboards to fill headcount");
const afterAutoManager = closeMsgs(manager);
assert(
  afterAutoManager.length === beforeAutoManager + 1,
  "creator receives auto-close message"
);
assert(
  afterAutoManager.some(
    (m) =>
      m.ref_id === autoJobId &&
      String(m.body).includes("满编自动关闭岗") &&
      String(m.body).includes("招聘人数已满")
  ),
  "auto-close body has title and reason"
);
assert(
  closeMsgs(admin).length === beforeAutoAdmin,
  "admin onboard actor does not self-notify auto-close"
);

console.log(`Recruitment job close notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
