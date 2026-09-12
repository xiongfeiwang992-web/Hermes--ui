import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "public-pool-settings-notify-smoke.db")).dbPath
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
const settingMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "customer_public_pool" && m.title === "掉公规则已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call("customer.publicPool.update", { public_pool_days: 15 }, manager).ok,
  "manager cannot update public pool settings"
);

const beforeAdmin = settingMsgs(admin).length;
const beforeManager = settingMsgs(manager).length;
const beforeAgent = settingMsgs(agent).length;
const updated = app.call(
  "customer.publicPool.update",
  { public_pool_days: 30 },
  admin
);
assert(updated.ok, "admin updates public pool days");
assert(settingMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(settingMsgs(manager).length === beforeManager + 1, "manager receives settings message");
assert(settingMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  settingMsgs(manager).some((m) => String(m.body).includes("30") && String(m.body).includes("掉公")),
  "settings message body for enable"
);

const beforeDisable = settingMsgs(manager).length;
assert(
  app.call("customer.publicPool.update", { public_pool_days: 0 }, admin).ok,
  "admin disables public pool"
);
assert(settingMsgs(manager).length === beforeDisable + 1, "manager receives disable message");
assert(
  settingMsgs(manager).some((m) => String(m.body).includes("自动掉公已关闭")),
  "disable message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { customer: false } }, manager).ok,
  "mute customer"
);
const beforeMute = settingMsgs(manager).length;
assert(
  app.call("customer.publicPool.update", { public_pool_days: 7 }, admin).ok,
  "update while muted"
);
assert(settingMsgs(manager).length === beforeMute, "muted customer suppresses message");

console.log(`Public pool settings notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
