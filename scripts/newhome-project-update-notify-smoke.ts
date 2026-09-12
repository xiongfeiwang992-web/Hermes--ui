import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "newhome-project-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "newhome_project" && m.title === "新房项目已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const created = app.call(
  "newhome.projects.save",
  {
    name: "更新通知楼盘原稿",
    address: "更新大道 1 号",
    property_type: "residential",
    protection_days: 15,
    contact_name: "项目联络人",
    contact_phone: "13978001111",
  },
  manager
);
assert(created.ok, "manager creates project");
const projectId = data<any>(created).id;

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "newhome.projects.save",
  {
    id: projectId,
    name: "更新通知楼盘改稿",
    address: "更新大道 2 号",
    property_type: "residential",
    protection_days: 20,
  },
  manager
);
assert(updated.ok, "manager updates project");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives update message");
assert(updateMsgs(manager).length === beforeManager, "updater does not self-notify");
assert(updateMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  updateMsgs(admin).some(
    (m) =>
      m.ref_id === projectId &&
      m.ref_type === "newhome_project" &&
      String(m.body).includes("更新通知楼盘改稿") &&
      String(m.body).includes("更新大道 2 号")
  ),
  "update message body"
);

const beforeSelfAdmin = updateMsgs(admin).length;
const beforeSelfMgr = updateMsgs(manager).length;
assert(
  app.call(
    "newhome.projects.save",
    {
      id: projectId,
      name: "管理员改项目名",
      address: "更新大道 3 号",
      property_type: "apartment",
      protection_days: 12,
    },
    admin
  ).ok,
  "admin updates project"
);
assert(updateMsgs(admin).length === beforeSelfAdmin, "admin actor skips self");
assert(updateMsgs(manager).length === beforeSelfMgr + 1, "manager receives admin update");

assert(
  app.call("message.subscriptions.save", { channels: { newhome: false } }, admin).ok,
  "mute newhome"
);
const beforeMute = updateMsgs(admin).length;
assert(
  app.call(
    "newhome.projects.save",
    {
      id: projectId,
      name: "静音更新楼盘",
      address: "静音大道 9 号",
      property_type: "shop",
      protection_days: 7,
    },
    manager
  ).ok,
  "update while muted"
);
assert(updateMsgs(admin).length === beforeMute, "muted newhome suppresses message");

console.log(`Newhome project update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
