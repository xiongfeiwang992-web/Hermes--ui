import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "house_agent" && m.title === "房源信息已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

const created = app.call(
  "house.create",
  {
    title: "更新通知房源原稿",
    deal_type: "sale",
    community: "更新小区",
    price: 210,
    owner_name: "更新业主",
    owner_phone: "13888001111",
    status: "available",
  },
  agent
);
assert(created.ok, "agent creates house for update");
const houseId = data<any>(created).id;

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "house.update",
  {
    id: houseId,
    title: "更新通知房源改稿",
    remark: "标题已改",
  },
  agent
);
assert(updated.ok, "agent updates house");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives house update message");
assert(updateMsgs(manager).length === beforeManager + 1, "manager receives house update message");
assert(updateMsgs(agent).length === beforeAgent, "updater does not self-notify");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === houseId &&
      m.ref_type === "house" &&
      String(m.body).includes("更新通知房源改稿") &&
      String(m.body).includes(agentName)
  ),
  "house update message body"
);

const beforeSelfMgr = updateMsgs(manager).length;
const beforeSelfAdmin = updateMsgs(admin).length;
assert(
  app.call(
    "house.update",
    { id: houseId, remark: "店长备注" },
    manager
  ).ok,
  "manager updates house"
);
assert(updateMsgs(manager).length === beforeSelfMgr, "manager actor skips self");
assert(updateMsgs(admin).length === beforeSelfAdmin + 1, "admin notified for manager update");

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, admin).ok,
  "mute house"
);
const beforeMute = updateMsgs(admin).length;
const beforeMuteMgr = updateMsgs(manager).length;
assert(
  app.call(
    "house.update",
    { id: houseId, title: "静音更新房源" },
    agent
  ).ok,
  "update while muted"
);
assert(updateMsgs(admin).length === beforeMute, "muted house suppresses message");
assert(
  updateMsgs(manager).length === beforeMuteMgr + 1,
  "manager still receives when admin muted"
);

console.log(`House update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
