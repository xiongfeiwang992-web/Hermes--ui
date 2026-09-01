import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "distribution-status-notify-smoke.db")).dbPath
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
const distMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "distribution_status" &&
      (m.title === "分销公司已启用" || m.title === "分销公司已停用")
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const partner = app.call(
  "newhome.distribution.save",
  {
    name: "通知分销公司",
    contact_name: "渠道王",
    contact_phone: "13988001111",
    address: "分销路 1 号",
  },
  manager
);
assert(partner.ok, "create distribution company");
const partnerId = data<any>(partner).id;

const beforeAdmin = distMsgs(admin).length;
const beforeManager = distMsgs(manager).length;
const beforeAgent = distMsgs(agent).length;
assert(
  app.call(
    "newhome.distribution.status",
    { id: partnerId, status: "inactive" },
    manager
  ).ok,
  "manager disables partner"
);
assert(distMsgs(admin).length === beforeAdmin + 1, "admin receives disable message");
assert(distMsgs(manager).length === beforeManager, "actor does not self-notify");
assert(distMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  distMsgs(admin).some(
    (m) =>
      m.ref_id === partnerId &&
      m.title === "分销公司已停用" &&
      String(m.body).includes("通知分销公司")
  ),
  "disable message body"
);

const beforeEnableAdmin = distMsgs(admin).length;
assert(
  app.call(
    "newhome.distribution.status",
    { id: partnerId, status: "active" },
    admin
  ).ok,
  "admin enables partner"
);
assert(distMsgs(admin).length === beforeEnableAdmin, "admin actor skips self on enable");
assert(
  distMsgs(manager).some(
    (m) => m.ref_id === partnerId && m.title === "分销公司已启用"
  ),
  "manager receives enable message"
);

assert(
  app.call("message.subscriptions.save", { channels: { newhome: false } }, admin).ok,
  "mute newhome"
);
const beforeMute = distMsgs(admin).length;
assert(
  app.call(
    "newhome.distribution.status",
    { id: partnerId, status: "inactive" },
    manager
  ).ok,
  "disable while muted"
);
assert(distMsgs(admin).length === beforeMute, "muted newhome suppresses message");

console.log(`Distribution status notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
