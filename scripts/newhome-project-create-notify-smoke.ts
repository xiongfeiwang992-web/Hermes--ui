import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "newhome-project-create-notify-smoke.db")).dbPath
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
const projectMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "newhome_project" && m.title === "新房项目已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const beforeAdmin = projectMsgs(admin).length;
const beforeManager = projectMsgs(manager).length;
const beforeAgent = projectMsgs(agent).length;
const created = app.call(
  "newhome.projects.save",
  {
    name: "通知楼盘A",
    address: "通知大道 1 号",
    property_type: "residential",
    protection_days: 15,
    contact_name: "项目联络人",
    contact_phone: "13977001111",
  },
  manager
);
assert(created.ok, "manager creates project");
const projectId = data<any>(created).id;
assert(projectMsgs(admin).length === beforeAdmin + 1, "admin receives project message");
assert(projectMsgs(manager).length === beforeManager, "creator does not self-notify");
assert(projectMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  projectMsgs(admin).some(
    (m) =>
      m.ref_id === projectId &&
      String(m.body).includes("通知楼盘A") &&
      String(m.body).includes("通知大道 1 号")
  ),
  "project message body"
);

const beforeSelfAdmin = projectMsgs(admin).length;
const beforeSelfMgr = projectMsgs(manager).length;
const adminProject = app.call(
  "newhome.projects.save",
  {
    name: "通知楼盘B",
    address: "通知大道 2 号",
    property_type: "apartment",
    protection_days: 10,
  },
  admin
);
assert(adminProject.ok, "admin creates project");
assert(projectMsgs(admin).length === beforeSelfAdmin, "admin actor skips self");
assert(projectMsgs(manager).length === beforeSelfMgr + 1, "manager receives admin create");

assert(
  app.call("message.subscriptions.save", { channels: { newhome: false } }, admin).ok,
  "mute newhome"
);
const beforeMute = projectMsgs(admin).length;
assert(
  app.call(
    "newhome.projects.save",
    {
      name: "静音楼盘",
      address: "静音大道 3 号",
      property_type: "shop",
      protection_days: 7,
    },
    manager
  ).ok,
  "create while muted"
);
assert(projectMsgs(admin).length === beforeMute, "muted newhome suppresses message");

console.log(`Newhome project create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
