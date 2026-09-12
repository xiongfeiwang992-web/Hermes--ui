import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "recruitment-job-create-notify-smoke.db")).dbPath
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
    (m) => m.kind === "recruitment" && m.title === "招聘岗位已发布"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const options = app.call("recruitment.options", {}, admin);
assert(options.ok, "admin recruitment options");
const storeA = data<any>(options).stores.find((s: any) => s.name === "一号店").id;

assert(
  !app.call(
    "recruitment.jobs.save",
    { title: "无效", store_id: storeA, target_role: "agent", headcount: 0 },
    manager
  ).ok,
  "headcount validated"
);

const beforeAdmin = createMsgs(admin).length;
const beforeManager = createMsgs(manager).length;
const beforeAgent = createMsgs(agentA).length;
const job = app.call(
  "recruitment.jobs.save",
  {
    title: "岗位发布通知经纪人",
    store_id: storeA,
    target_role: "agent",
    headcount: 2,
  },
  manager
);
assert(job.ok, "manager publishes job");
const jobId = data<any>(job).id;
assert(createMsgs(admin).length === beforeAdmin + 1, "admin receives publish message");
assert(createMsgs(manager).length === beforeManager, "publisher does not self-notify");
assert(createMsgs(agentA).length === beforeAgent, "agent not notified");
assert(
  createMsgs(admin).some(
    (m) =>
      m.ref_id === jobId &&
      String(m.body).includes("岗位发布通知经纪人") &&
      String(m.body).includes("agent") &&
      String(m.body).includes("2 人")
  ),
  "publish message body"
);

const beforeManager2 = createMsgs(manager).length;
const beforeAdmin2 = createMsgs(admin).length;
assert(
  app.call(
    "recruitment.jobs.save",
    {
      title: "管理员发布财务岗",
      store_id: storeA,
      target_role: "finance",
      headcount: 1,
    },
    admin
  ).ok,
  "admin publishes finance job"
);
assert(createMsgs(manager).length === beforeManager2 + 1, "store manager receives admin publish");
assert(createMsgs(admin).length === beforeAdmin2, "admin actor does not self-notify");

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, admin).ok,
  "mute hr"
);
const beforeMute = createMsgs(admin).length;
assert(
  app.call(
    "recruitment.jobs.save",
    {
      title: "静音发布岗",
      store_id: storeA,
      target_role: "agent",
      headcount: 1,
    },
    manager
  ).ok,
  "publish while muted"
);
assert(createMsgs(admin).length === beforeMute, "muted hr suppresses publish message");

console.log(
  `Recruitment job create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
