import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "attachment-delete-notify-smoke.db")).dbPath
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
const deleteMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "附件已删除"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const house = app.call(
  "house.create",
  {
    title: "删图通知盘",
    deal_type: "sale",
    community: "删图苑",
    price: 210,
    owner_name: "删图业主",
    owner_phone: "13870002222",
    status: "available",
  },
  agent
);
assert(house.ok, "agent creates house");
const houseId = data<any>(house).id;
const fixture = path.resolve("data", "attachment-delete-notify-fixture.txt");
fs.writeFileSync(fixture, "delete fixture", "utf8");

const photo = app.call(
  "attachment.add",
  {
    parent_type: "house",
    parent_id: houseId,
    category: "photo",
    name: "待删客厅.txt",
    local_path: fixture,
  },
  agent
);
assert(photo.ok, "agent uploads photo");
const photoId = data<any>(photo).id;

assert(
  !app.call("attachment.delete", { id: photoId, reason: "误传图片需要删除" }, peer).ok,
  "peer cannot delete house photo"
);

const beforeAgent = deleteMsgs(agent).length;
const beforeManager = deleteMsgs(manager).length;
const beforePeer = deleteMsgs(peer).length;
const deleted = app.call(
  "attachment.delete",
  { id: photoId, reason: "误传图片需要删除" },
  manager
);
assert(deleted.ok, "manager deletes house photo");
assert(deleteMsgs(agent).length === beforeAgent + 1, "house agent receives delete message");
assert(deleteMsgs(manager).length === beforeManager, "deleter skips self");
assert(deleteMsgs(peer).length === beforePeer, "peer not notified");
assert(
  deleteMsgs(agent).some(
    (m) =>
      m.ref_id === photoId &&
      m.ref_type === "attachment" &&
      String(m.body).includes("删图通知盘") &&
      String(m.body).includes("待删客厅.txt") &&
      String(m.body).includes("误传图片需要删除")
  ),
  "delete message body"
);

const photo2 = app.call(
  "attachment.add",
  {
    parent_type: "house",
    parent_id: houseId,
    category: "photo",
    name: "自删图.txt",
    local_path: fixture,
  },
  agent
);
assert(photo2.ok, "agent uploads second photo");
const beforeSelf = deleteMsgs(agent).length;
assert(
  app.call(
    "attachment.delete",
    { id: data<any>(photo2).id, reason: "自己误传需要删除" },
    agent
  ).ok,
  "agent deletes own photo"
);
assert(deleteMsgs(agent).length === beforeSelf, "self delete does not notify agent");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const photo3 = app.call(
  "attachment.add",
  {
    parent_type: "house",
    parent_id: houseId,
    category: "photo",
    name: "静音删图.txt",
    local_path: fixture,
  },
  agent
);
assert(photo3.ok, "upload for mute test");
const beforeMute = deleteMsgs(agent).length;
assert(
  app.call(
    "attachment.delete",
    { id: data<any>(photo3).id, reason: "静音场景删除图片" },
    manager
  ).ok,
  "delete while muted"
);
assert(deleteMsgs(agent).length === beforeMute, "muted other suppresses delete message");

console.log(`Attachment delete notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
