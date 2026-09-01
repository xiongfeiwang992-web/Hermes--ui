import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "permission-set-notify-smoke.db")).dbPath
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
const permMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "功能权限已变更"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "permission.set",
    { role: "agent", feature: "report.*", allowed: false },
    manager
  ).ok,
  "manager cannot set permission"
);

const beforeAdmin = permMsgs(admin).length;
const beforeManager = permMsgs(manager).length;
const beforeAgent = permMsgs(agent).length;
const set = app.call(
  "permission.set",
  { role: "agent", feature: "report.*", allowed: false },
  admin
);
assert(set.ok, "admin disables agent report");
const permId = data<any>(set).id;
assert(permMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(permMsgs(manager).length === beforeManager + 1, "manager receives permission message");
assert(permMsgs(agent).length === beforeAgent, "agent not notified on permission set");
assert(
  permMsgs(manager).some(
    (m) =>
      m.ref_id === permId &&
      m.ref_type === "feature_permission" &&
      String(m.body).includes("agent") &&
      String(m.body).includes("report.*") &&
      String(m.body).includes("禁止")
  ),
  "permission message body"
);

const beforeUpdate = permMsgs(manager).length;
assert(
  app.call(
    "permission.set",
    { role: "agent", feature: "report.*", allowed: true },
    admin
  ).ok,
  "admin restores agent report"
);
assert(permMsgs(manager).length === beforeUpdate + 1, "update also notifies");
assert(
  permMsgs(manager).some((m) => String(m.body).includes("允许")),
  "restore body says allowed"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = permMsgs(manager).length;
assert(
  app.call(
    "permission.set",
    { role: "finance", feature: "report.*", allowed: false },
    admin
  ).ok,
  "set while muted"
);
assert(permMsgs(manager).length === beforeMute, "muted other suppresses permission message");

console.log(`Permission set notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
