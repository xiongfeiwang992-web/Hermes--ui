import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "attachment-add-notify-smoke.db")).dbPath
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
const attachMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "附件已上传"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const house = app.call(
  "house.create",
  {
    title: "附件通知盘",
    deal_type: "sale",
    community: "附件苑",
    price: 200,
    owner_name: "附件业主",
    owner_phone: "13870001111",
    status: "available",
  },
  agent
);
assert(house.ok, "agent creates house");
const houseId = data<any>(house).id;

const fixture = path.resolve("data", "attachment-add-notify-fixture.txt");
fs.writeFileSync(fixture, "attachment fixture", "utf8");

const beforeAgent = attachMsgs(agent).length;
const beforeManager = attachMsgs(manager).length;
const beforePeer = attachMsgs(peer).length;
const uploaded = app.call(
  "attachment.add",
  {
    parent_type: "house",
    parent_id: houseId,
    category: "photo",
    name: "客厅.txt",
    local_path: fixture,
  },
  manager
);
assert(uploaded.ok, "manager uploads house photo");
const attachmentId = data<any>(uploaded).id;
assert(attachMsgs(agent).length === beforeAgent + 1, "house agent receives attachment message");
assert(attachMsgs(manager).length === beforeManager, "uploader skips self");
assert(attachMsgs(peer).length === beforePeer, "peer agent not notified");
assert(
  attachMsgs(agent).some(
    (m) =>
      m.ref_id === attachmentId &&
      m.ref_type === "attachment" &&
      String(m.body).includes("附件通知盘") &&
      String(m.body).includes("客厅.txt")
  ),
  "house attachment message body"
);

const beforeSelf = attachMsgs(agent).length;
assert(
  app.call(
    "attachment.add",
    {
      parent_type: "house",
      parent_id: houseId,
      category: "photo",
      name: "卧室.txt",
      local_path: fixture,
    },
    agent
  ).ok,
  "agent uploads own house photo"
);
assert(attachMsgs(agent).length === beforeSelf, "self upload does not notify agent");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const beforeMute = attachMsgs(agent).length;
assert(
  app.call(
    "attachment.add",
    {
      parent_type: "house",
      parent_id: houseId,
      category: "photo",
      name: "静音图.txt",
      local_path: fixture,
    },
    manager
  ).ok,
  "upload while muted"
);
assert(attachMsgs(agent).length === beforeMute, "muted other suppresses attachment message");

console.log(`Attachment add notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
