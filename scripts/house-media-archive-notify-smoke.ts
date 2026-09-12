import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const mediaPath = path.resolve("data", "house-media-archive-notify.bin");
fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
fs.writeFileSync(mediaPath, "fake media", "utf8");

const app = createApp(
  seedDatabase(path.resolve("data", "house-media-archive-notify-smoke.db")).dbPath
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
const archiveMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "house_agent" && m.title === "房源媒体已归档"
  );

const manager = login("manager");
const agent = login("agent_a");

const house = app.call(
  "house.create",
  {
    title: "归档通知房源",
    deal_type: "sale",
    community: "归档小区",
    price: 205,
    owner_name: "归档业主",
    owner_phone: "13633002222",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const media = app.call(
  "propertyExt.media.add",
  {
    house_id: houseId,
    media_type: "panorama",
    title: "待归档全景",
    local_path: mediaPath,
  },
  agent
);
assert(media.ok, "holder adds media");
const mediaId = data<any>(media).id;

const beforeAgent = archiveMsgs(agent).length;
const beforeManager = archiveMsgs(manager).length;
const archived = app.call("propertyExt.media.archive", { id: mediaId }, manager);
assert(archived.ok, "manager archives media");
assert(archiveMsgs(agent).length === beforeAgent + 1, "holder receives archive message");
assert(archiveMsgs(manager).length === beforeManager, "archiver does not self-notify");
assert(
  archiveMsgs(agent).some(
    (m) =>
      m.ref_id === mediaId &&
      String(m.body).includes("归档通知房源") &&
      String(m.body).includes("panorama") &&
      String(m.body).includes("待归档全景")
  ),
  "archive message body"
);

const media2 = app.call(
  "propertyExt.media.add",
  {
    house_id: houseId,
    media_type: "video",
    title: "自行归档视频",
    local_path: mediaPath,
  },
  agent
);
assert(media2.ok, "holder adds second media");
const beforeSelf = archiveMsgs(agent).length;
assert(
  app.call("propertyExt.media.archive", { id: data<any>(media2).id }, agent).ok,
  "holder self archives"
);
assert(archiveMsgs(agent).length === beforeSelf, "self archive skips notify");

const media3 = app.call(
  "propertyExt.media.add",
  {
    house_id: houseId,
    media_type: "panorama",
    title: "静音归档全景",
    local_path: mediaPath,
  },
  agent
);
assert(media3.ok, "add muted media");
assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agent).ok,
  "mute house"
);
const beforeMute = archiveMsgs(agent).length;
assert(
  app.call("propertyExt.media.archive", { id: data<any>(media3).id }, manager).ok,
  "archive while muted"
);
assert(archiveMsgs(agent).length === beforeMute, "muted house suppresses message");

console.log(`House media archive notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
