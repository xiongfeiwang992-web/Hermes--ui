import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "recruitment-candidate-create-notify-smoke.db")).dbPath
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
const createMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "recruitment" && m.title === "新招聘候选人"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const options = app.call("recruitment.options", {}, admin);
assert(options.ok, "admin recruitment options");
const storeA = data<any>(options).stores.find((s: any) => s.name === "一号店").id;

const job = app.call(
  "recruitment.jobs.save",
  {
    title: "候选人通知经纪人岗",
    store_id: storeA,
    target_role: "agent",
    headcount: 3,
  },
  manager
);
assert(job.ok, "manager creates job");
const jobId = data<any>(job).id;

assert(
  !app.call(
    "recruitment.candidates.create",
    { job_id: jobId, name: "无效", phone: "12" },
    manager
  ).ok,
  "invalid phone rejected"
);

const beforeAdmin = createMsgs(admin).length;
const beforeManager = createMsgs(manager).length;
const beforeAgent = createMsgs(agentA).length;
const candidate = app.call(
  "recruitment.candidates.create",
  {
    job_id: jobId,
    name: "候选人通知甲",
    phone: "13952220001",
    source: "内推",
  },
  manager
);
assert(candidate.ok, "manager creates candidate");
const candidateId = data<any>(candidate).id;
assert(createMsgs(admin).length === beforeAdmin + 1, "admin receives create message");
assert(createMsgs(manager).length === beforeManager, "creator actor does not self-notify");
assert(createMsgs(agentA).length === beforeAgent, "agent not notified");
assert(
  createMsgs(admin).some(
    (m) =>
      m.ref_id === candidateId &&
      String(m.body).includes("候选人通知甲") &&
      String(m.body).includes("候选人通知经纪人岗")
  ),
  "create message body"
);

const beforeManager2 = createMsgs(manager).length;
const beforeAdmin2 = createMsgs(admin).length;
const candidate2 = app.call(
  "recruitment.candidates.create",
  {
    job_id: jobId,
    name: "候选人通知乙",
    phone: "13952220002",
  },
  admin
);
assert(candidate2.ok, "admin creates candidate on manager job");
assert(
  createMsgs(manager).length === beforeManager2 + 1,
  "job creator receives when admin creates"
);
assert(createMsgs(admin).length === beforeAdmin2, "admin actor does not self-notify");

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, admin).ok,
  "mute hr"
);
const beforeMute = createMsgs(admin).length;
assert(
  app.call(
    "recruitment.candidates.create",
    {
      job_id: jobId,
      name: "静音候选人",
      phone: "13952220003",
    },
    manager
  ).ok,
  "create while muted"
);
assert(createMsgs(admin).length === beforeMute, "muted hr suppresses create message");

console.log(
  `Recruitment candidate create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
