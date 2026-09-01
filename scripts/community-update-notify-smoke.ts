import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "community-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "小区信息已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const created = app.call(
  "property.communities.upsert",
  {
    name: "更新通知花园",
    district: "更新区",
    address: "更新路 1 号",
  },
  agent
);
assert(created.ok, "agent creates community");
const communityId = data<any>(created).id;

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "property.communities.upsert",
  {
    id: communityId,
    name: "更新通知花园改",
    district: "更新区",
    address: "更新路 2 号",
  },
  agent
);
assert(updated.ok, "agent updates community");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives update message");
assert(updateMsgs(manager).length === beforeManager + 1, "manager receives update message");
assert(updateMsgs(agent).length === beforeAgent, "updater not in admin/manager recipients");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === communityId &&
      m.ref_type === "community" &&
      String(m.body).includes("更新通知花园改")
  ),
  "update message body"
);

const beforeSecond = updateMsgs(manager).length;
assert(
  app.call(
    "property.communities.upsert",
    {
      id: communityId,
      name: "更新通知花园再改",
      district: "更新区",
    },
    manager
  ).ok,
  "manager updates community"
);
assert(updateMsgs(manager).length === beforeSecond, "manager actor skips self");
assert(updateMsgs(admin).length === beforeAdmin + 2, "admin still notified on manager update");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = updateMsgs(manager).length;
assert(
  app.call(
    "property.communities.upsert",
    {
      id: communityId,
      name: "静音小区名",
      district: "更新区",
    },
    agent
  ).ok,
  "update while muted"
);
assert(updateMsgs(manager).length === beforeMute, "muted other suppresses update message");

console.log(`Community update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
