import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const mediaPath = path.resolve("data", "house-media-add-notify.bin");
fs.mkdirSync(path.dirname(mediaPath), { recursive: true });
fs.writeFileSync(mediaPath, "fake media", "utf8");

const app = createApp(
  seedDatabase(path.resolve("data", "house-media-add-notify-smoke.db")).dbPath
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
const mediaMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "house_agent" && m.title === "房源媒体已登记"
  );

const manager = login("manager");
const agent = login("agent_a");

const house = app.call(
  "house.create",
  {
    title: "媒体通知房源",
    deal_type: "sale",
    community: "媒体小区",
    price: 210,
    owner_name: "媒体业主",
    owner_phone: "13633001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const beforeAgent = mediaMsgs(agent).length;
const beforeManager = mediaMsgs(manager).length;
const added = app.call(
  "propertyExt.media.add",
  {
    house_id: houseId,
    media_type: "panorama",
    title: "客厅全景",
    local_path: mediaPath,
  },
  manager
);
assert(added.ok, "manager adds media");
const mediaId = data<any>(added).id;
assert(mediaMsgs(agent).length === beforeAgent + 1, "holder receives media message");
assert(mediaMsgs(manager).length === beforeManager, "uploader does not self-notify");
assert(
  mediaMsgs(agent).some(
    (m) =>
      m.ref_id === mediaId &&
      String(m.body).includes("媒体通知房源") &&
      String(m.body).includes("panorama") &&
      String(m.body).includes("客厅全景")
  ),
  "media message body"
);

const beforeSelf = mediaMsgs(agent).length;
assert(
  app.call(
    "propertyExt.media.add",
    {
      house_id: houseId,
      media_type: "video",
      title: "自行上传视频",
      local_path: mediaPath,
    },
    agent
  ).ok,
  "holder self upload"
);
assert(mediaMsgs(agent).length === beforeSelf, "self upload skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agent).ok,
  "mute house"
);
const beforeMute = mediaMsgs(agent).length;
assert(
  app.call(
    "propertyExt.media.add",
    {
      house_id: houseId,
      media_type: "panorama",
      title: "静音全景",
      local_path: mediaPath,
    },
    manager
  ).ok,
  "add while muted"
);
assert(mediaMsgs(agent).length === beforeMute, "muted house suppresses message");

console.log(`House media add notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
