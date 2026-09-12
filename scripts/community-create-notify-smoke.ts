import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "community-create-notify-smoke.db")).dbPath
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
const communityMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "新小区已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const beforeAdmin = communityMsgs(admin).length;
const beforeManager = communityMsgs(manager).length;
const beforeAgent = communityMsgs(agent).length;
const created = app.call(
  "property.communities.upsert",
  {
    name: "通知花园",
    district: "通知区",
    address: "通知路 1 号",
    building_count: 6,
  },
  agent
);
assert(created.ok, "agent creates community");
const communityId = data<any>(created).id;
assert(communityMsgs(admin).length === beforeAdmin + 1, "admin receives community message");
assert(communityMsgs(manager).length === beforeManager + 1, "manager receives community message");
assert(communityMsgs(agent).length === beforeAgent, "creator does not self-notify");
assert(
  communityMsgs(manager).some(
    (m) =>
      m.ref_id === communityId &&
      String(m.body).includes("通知花园") &&
      String(m.body).includes("通知区")
  ),
  "community message body"
);

const beforeUpdateAdmin = communityMsgs(admin).length;
const updated = app.call(
  "property.communities.upsert",
  {
    id: communityId,
    name: "通知花园改",
    district: "通知区",
    address: "通知路 1 号",
  },
  agent
);
assert(updated.ok, "agent updates community");
assert(communityMsgs(admin).length === beforeUpdateAdmin, "update does not re-notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = communityMsgs(manager).length;
const beforeMuteAdmin = communityMsgs(admin).length;
assert(
  app.call(
    "property.communities.upsert",
    { name: "静音花园", district: "静音区", address: "静音路 2 号" },
    agent
  ).ok,
  "create while muted"
);
assert(communityMsgs(manager).length === beforeMute, "muted other suppresses message");
assert(communityMsgs(admin).length === beforeMuteAdmin + 1, "admin still receives when manager muted");

console.log(`Community create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
