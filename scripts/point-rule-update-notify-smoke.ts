import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "point-rule-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "performance" && m.title === "积分规则已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const created = app.call(
  "performance.rules.save",
  {
    code: "UPD_SURVEY",
    name: "更新实勘积分",
    points: 12,
    applicable_role: "agent",
  },
  admin
);
assert(created.ok, "admin creates point rule");
const ruleId = data<any>(created).id;

assert(
  !app.call(
    "performance.rules.save",
    {
      id: ruleId,
      code: "UPD_SURVEY",
      name: "店长不可改",
      points: 15,
    },
    manager
  ).ok,
  "manager cannot update point rule"
);

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "performance.rules.save",
  {
    id: ruleId,
    code: "UPD_SURVEY",
    name: "更新实勘积分改",
    points: 18,
    applicable_role: "agent",
  },
  admin
);
assert(updated.ok, "admin updates point rule");
assert(updateMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(updateMsgs(manager).length === beforeManager + 1, "manager receives update message");
assert(updateMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === ruleId &&
      m.ref_type === "performance_point_rule" &&
      String(m.body).includes("更新实勘积分改") &&
      String(m.body).includes("UPD_SURVEY") &&
      String(m.body).includes("18")
  ),
  "update message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { performance: false } }, manager).ok,
  "mute performance"
);
const beforeMute = updateMsgs(manager).length;
assert(
  app.call(
    "performance.rules.save",
    {
      id: ruleId,
      code: "UPD_SURVEY",
      name: "静音积分规则更新",
      points: 20,
      applicable_role: "agent",
    },
    admin
  ).ok,
  "update while muted"
);
assert(updateMsgs(manager).length === beforeMute, "muted performance suppresses update message");

console.log(`Point rule update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
