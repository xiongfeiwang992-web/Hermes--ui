import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "point-rule-create-notify-smoke.db")).dbPath
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
const ruleMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "performance" && m.title === "积分规则已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "performance.rules.save",
    { code: "VIEW", name: "带看积分", points: 5 },
    manager
  ).ok,
  "manager cannot create point rule"
);

const beforeAdmin = ruleMsgs(admin).length;
const beforeManager = ruleMsgs(manager).length;
const beforeAgent = ruleMsgs(agent).length;
const created = app.call(
  "performance.rules.save",
  {
    code: "NOTIFY_SURVEY",
    name: "通知实勘积分",
    points: 12,
    applicable_role: "agent",
  },
  admin
);
assert(created.ok, "admin creates point rule");
const ruleId = data<any>(created).id;
assert(ruleMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(ruleMsgs(manager).length === beforeManager + 1, "manager receives rule message");
assert(ruleMsgs(agent).length === beforeAgent, "agent not notified on rule create");
assert(
  ruleMsgs(manager).some(
    (m) =>
      m.ref_id === ruleId &&
      String(m.body).includes("通知实勘积分") &&
      String(m.body).includes("NOTIFY_SURVEY") &&
      String(m.body).includes("12")
  ),
  "rule message body"
);

const beforeUpdate = ruleMsgs(manager).length;
assert(
  app.call(
    "performance.rules.save",
    {
      id: ruleId,
      code: "NOTIFY_SURVEY",
      name: "通知实勘积分改",
      points: 15,
      applicable_role: "agent",
    },
    admin
  ).ok,
  "admin updates point rule"
);
assert(ruleMsgs(manager).length === beforeUpdate, "update does not re-notify");

assert(
  app.call("message.subscriptions.save", { channels: { performance: false } }, manager).ok,
  "mute performance"
);
const beforeMute = ruleMsgs(manager).length;
assert(
  app.call(
    "performance.rules.save",
    { code: "MUTE_RULE", name: "静音积分规则", points: 3 },
    admin
  ).ok,
  "create while muted"
);
assert(ruleMsgs(manager).length === beforeMute, "muted performance suppresses message");

console.log(`Point rule create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
