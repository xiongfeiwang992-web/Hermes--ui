import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "recruitment-job-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "recruitment" && m.title === "招聘岗位已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const options = app.call("recruitment.options", {}, admin);
assert(options.ok, "admin recruitment options");
const storeA = data<any>(options).stores.find((s: any) => s.name === "一号店").id;

const created = app.call(
  "recruitment.jobs.save",
  {
    title: "岗位更新通知原稿",
    store_id: storeA,
    target_role: "agent",
    headcount: 2,
  },
  manager
);
assert(created.ok, "manager creates job for update");
const jobId = data<any>(created).id;

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agentA).length;
const updated = app.call(
  "recruitment.jobs.save",
  {
    id: jobId,
    title: "岗位更新通知改稿",
    store_id: storeA,
    target_role: "agent",
    headcount: 3,
    requirements: "有带看经验",
  },
  manager
);
assert(updated.ok, "manager updates job");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives update message");
assert(updateMsgs(manager).length === beforeManager, "updater does not self-notify");
assert(updateMsgs(agentA).length === beforeAgent, "agent not notified");
assert(
  updateMsgs(admin).some(
    (m) =>
      m.ref_id === jobId &&
      m.ref_type === "recruitment_job" &&
      String(m.body).includes("岗位更新通知改稿") &&
      String(m.body).includes("agent") &&
      String(m.body).includes("3 人")
  ),
  "update message body"
);

const beforeManager2 = updateMsgs(manager).length;
const beforeAdmin2 = updateMsgs(admin).length;
assert(
  app.call(
    "recruitment.jobs.save",
    {
      id: jobId,
      title: "管理员改招聘人数",
      store_id: storeA,
      target_role: "agent",
      headcount: 4,
    },
    admin
  ).ok,
  "admin updates job"
);
assert(updateMsgs(manager).length === beforeManager2 + 1, "store manager receives admin update");
assert(updateMsgs(admin).length === beforeAdmin2, "admin actor does not self-notify");

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, admin).ok,
  "mute hr"
);
const beforeMute = updateMsgs(admin).length;
assert(
  app.call(
    "recruitment.jobs.save",
    {
      id: jobId,
      title: "静音更新岗",
      store_id: storeA,
      target_role: "agent",
      headcount: 1,
    },
    manager
  ).ok,
  "update while muted"
);
assert(updateMsgs(admin).length === beforeMute, "muted hr suppresses update message");

console.log(
  `Recruitment job update notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
