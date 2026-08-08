import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "recruitment-smoke.db")).dbPath);
const resumePath = path.resolve("/tmp", "candidate-resume.txt");
fs.writeFileSync(resumePath, "local candidate resume");
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
const login = (account: string, password = "123456") => {
  const result = app.call("auth.login", { account, password });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const finance = login("finance");
const agentC = login("agent_c");
const options = app.call("recruitment.options", {}, admin);
check(
  options.ok && data<any>(options).stores.length === 2,
  "admin gets recruitment store options"
);
const storeA = data<any>(options).stores.find((store: any) => store.name === "一号店").id;
const storeB = data<any>(options).stores.find((store: any) => store.name === "二号店").id;
check(
  data<any>(app.call("recruitment.options", {}, manager)).stores.length === 1,
  "manager recruitment options restricted to own store"
);
check(!app.call("recruitment.options", {}, agentA).ok, "agent cannot access recruitment");
check(
  !app.call(
    "recruitment.jobs.save",
    {
      title: "无效人数岗位",
      store_id: storeA,
      target_role: "agent",
      headcount: 0,
    },
    admin
  ).ok,
  "job validates headcount"
);
check(
  !app.call(
    "recruitment.jobs.save",
    {
      title: "财务岗位",
      store_id: storeA,
      target_role: "finance",
      headcount: 1,
    },
    manager
  ).ok,
  "manager can only publish agent jobs"
);
const job = app.call(
  "recruitment.jobs.save",
  {
    title: "房产经纪人",
    store_id: storeB,
    target_role: "agent",
    headcount: 1,
    requirements: "沟通能力良好",
  },
  manager
);
check(job.ok, "manager publishes own-store agent job");
const jobId = data<any>(job).id;
const crossJob = app.call(
  "recruitment.jobs.save",
  {
    title: "二号店财务",
    store_id: storeB,
    target_role: "finance",
    headcount: 1,
  },
  admin
);
check(crossJob.ok, "admin publishes cross-store finance job");
check(
  data<any[]>(app.call("recruitment.jobs.list", {}, manager)).length === 1,
  "manager sees only own-store jobs"
);
check(
  !app.call(
    "recruitment.candidates.create",
    { job_id: jobId, name: "无效电话", phone: "123" },
    manager
  ).ok,
  "candidate validates phone"
);
const candidate = app.call(
  "recruitment.candidates.create",
  {
    job_id: jobId,
    name: "候选人甲",
    phone: "13950000001",
    source: "员工推荐",
    note: "沟通顺畅",
  },
  manager
);
check(candidate.ok && data<any>(candidate).status === "new", "manager creates candidate");
const candidateId = data<any>(candidate).id;
check(
  !app.call(
    "recruitment.candidates.create",
    {
      job_id: data<any>(crossJob).id,
      name: "重复候选人",
      phone: "13950000001",
    },
    admin
  ).ok,
  "active candidate phone deduplicated company-wide"
);
check(!app.call("recruitment.candidates.list", {}, agentA).ok, "agent cannot list candidates");
check(
  data<any[]>(app.call("recruitment.candidates.list", {}, manager)).length === 1,
  "manager lists own-store candidates"
);
check(
  !app.call(
    "recruitment.candidates.status",
    { id: candidateId, status: "offer" },
    manager
  ).ok,
  "candidate transition order enforced"
);
check(
  app.call(
    "recruitment.candidates.status",
    { id: candidateId, status: "screening" },
    manager
  ).ok,
  "candidate enters screening"
);
check(
  !app.call(
    "recruitment.candidates.status",
    {
      id: candidateId,
      status: "interview",
      interview_at: "2026-09-01T10:00:00.000Z",
    },
    manager
  ).ok,
  "resume required before interview"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "recruitment_candidate",
      parent_id: candidateId,
      category: "resume",
      name: "越权简历.txt",
      local_path: resumePath,
    },
    agentA
  ).ok,
  "agent cannot upload candidate resume"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "recruitment_candidate",
      parent_id: candidateId,
      category: "invalid",
      name: "错误分类.txt",
      local_path: resumePath,
    },
    manager
  ).ok,
  "candidate attachment category enforced"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "recruitment_candidate",
      parent_id: candidateId,
      category: "resume",
      name: "候选人甲简历.txt",
      local_path: resumePath,
    },
    manager
  ).ok,
  "manager uploads local candidate resume"
);
check(
  data<any[]>(
    app.call(
      "attachment.list",
      { parent_type: "recruitment_candidate", parent_id: candidateId },
      manager
    )
  ).length === 1,
  "manager lists candidate resume"
);
check(
  !app.call(
    "recruitment.candidates.status",
    { id: candidateId, status: "interview", interview_at: "invalid" },
    manager
  ).ok,
  "interview requires valid time"
);
check(
  app.call(
    "recruitment.candidates.status",
    {
      id: candidateId,
      status: "interview",
      interview_at: "2026-09-01T10:00:00.000Z",
      note: "到店复试",
    },
    manager
  ).ok,
  "schedule candidate interview"
);
check(
  app.call(
    "recruitment.candidates.status",
    { id: candidateId, status: "offer" },
    manager
  ).ok,
  "candidate receives offer"
);
check(
  !app.call(
    "recruitment.candidates.onboard",
    { id: candidateId, account: "candidate_a", password: "candidate-pass" },
    manager
  ).ok,
  "only admin can onboard candidate"
);
check(
  !app.call(
    "recruitment.candidates.onboard",
    { id: candidateId, account: "candidate_a", password: "short" },
    admin
  ).ok,
  "onboarding enforces password policy"
);
check(
  !app.call(
    "recruitment.candidates.onboard",
    { id: candidateId, account: "admin", password: "candidate-pass" },
    admin
  ).ok,
  "onboarding rejects duplicate account"
);
const onboarded = app.call(
  "recruitment.candidates.onboard",
  {
    id: candidateId,
    account: "candidate_a",
    display_name: "新员工甲",
    password: "candidate-pass",
  },
  admin
);
check(onboarded.ok && data<any>(onboarded).status === "hired", "admin onboards candidate");
const newEmployee = login("candidate_a", "candidate-pass");
const newEmployeeUser = data<any>(app.call("auth.me", {}, newEmployee));
check(
  newEmployeeUser.role === "agent" &&
    newEmployeeUser.store_id === storeA &&
    newEmployeeUser.phone === "13950000001",
  "onboarded account inherits job role store and candidate phone"
);
check(
  data<any[]>(app.call("recruitment.jobs.list", {}, manager)).find(
    (item) => item.id === jobId
  ).status === "closed",
  "job auto-closes when headcount filled"
);
check(
  !app.call(
    "recruitment.candidates.create",
    { job_id: jobId, name: "岗位已满", phone: "13950000002" },
    manager
  ).ok,
  "closed job rejects new candidate"
);
check(
  !app.call(
    "recruitment.candidates.status",
    { id: candidateId, status: "rejected", reason: "不可变更" },
    manager
  ).ok,
  "hired candidate is terminal"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "recruitment_candidate",
      parent_id: candidateId,
      category: "resume",
      name: "入职后简历.txt",
      local_path: resumePath,
    },
    manager
  ).ok,
  "hired candidate resume is immutable"
);

const secondJob = app.call(
  "recruitment.jobs.save",
  {
    title: "储备经纪人",
    store_id: storeA,
    target_role: "agent",
    headcount: 2,
  },
  admin
);
const rejected = app.call(
  "recruitment.candidates.create",
  {
    job_id: data<any>(secondJob).id,
    name: "候选人乙",
    phone: "13950000003",
  },
  manager
);
check(secondJob.ok && rejected.ok, "create candidate for rejection flow");
check(
  !app.call(
    "recruitment.candidates.status",
    { id: data<any>(rejected).id, status: "rejected", reason: "" },
    manager
  ).ok,
  "candidate rejection requires reason"
);
check(
  app.call(
    "recruitment.candidates.status",
    { id: data<any>(rejected).id, status: "rejected", reason: "经验不匹配" },
    manager
  ).ok,
  "manager rejects candidate with reason"
);
check(
  app.call(
    "recruitment.candidates.create",
    {
      job_id: data<any>(secondJob).id,
      name: "候选人乙重新应聘",
      phone: "13950000003",
    },
    manager
  ).ok,
  "rejected candidate phone may reapply"
);
const crossCandidate = app.call(
  "recruitment.candidates.create",
  {
    job_id: data<any>(crossJob).id,
    name: "二号店候选人",
    phone: "13950000004",
  },
  admin
);
check(crossCandidate.ok, "admin creates cross-store candidate");
check(
  !data<any[]>(app.call("recruitment.candidates.list", {}, manager)).some(
    (item) => item.id === data<any>(crossCandidate).id
  ),
  "manager cannot see another store candidate"
);
check(
  app.call("recruitment.jobs.close", { id: data<any>(secondJob).id }, manager).ok,
  "manager closes own-store job"
);
check(
  !app.call("recruitment.jobs.close", { id: data<any>(secondJob).id }, manager).ok,
  "closed job cannot close twice"
);
check(
  !app.call("recruitment.jobs.list", {}, finance).ok,
  "finance cannot manage recruitment"
);
check(
  !app.call("recruitment.candidates.list", {}, agentC).ok,
  "cross-store agent cannot access recruitment"
);

console.log(`Recruitment smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
