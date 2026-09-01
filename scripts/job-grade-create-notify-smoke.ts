import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "job-grade-create-notify-smoke.db")).dbPath
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
const gradeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "职级已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "workforce.grades.save",
    { code: "NG1", name: "店长不可建职级", rank_level: 1 },
    manager
  ).ok,
  "manager cannot create job grade"
);

const beforeAdmin = gradeMsgs(admin).length;
const beforeManager = gradeMsgs(manager).length;
const beforeAgent = gradeMsgs(agent).length;
const created = app.call(
  "workforce.grades.save",
  {
    code: "NG1",
    name: "通知初级职级",
    rank_level: 3,
    applicable_role: "agent",
  },
  admin
);
assert(created.ok, "admin creates job grade");
const gradeId = data<any>(created).id;
assert(gradeMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(gradeMsgs(manager).length === beforeManager + 1, "manager receives grade message");
assert(gradeMsgs(agent).length === beforeAgent, "agent not notified on grade create");
assert(
  gradeMsgs(manager).some(
    (m) =>
      m.ref_id === gradeId &&
      m.ref_type === "job_grade" &&
      String(m.body).includes("通知初级职级") &&
      String(m.body).includes("NG1") &&
      String(m.body).includes("L3")
  ),
  "grade message body"
);

const beforeUpdate = gradeMsgs(manager).length;
assert(
  app.call(
    "workforce.grades.save",
    {
      id: gradeId,
      code: "NG1",
      name: "通知初级职级改",
      rank_level: 4,
      applicable_role: "agent",
    },
    admin
  ).ok,
  "admin updates job grade"
);
assert(gradeMsgs(manager).length === beforeUpdate, "update does not re-notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = gradeMsgs(manager).length;
assert(
  app.call(
    "workforce.grades.save",
    { code: "NG2", name: "静音职级", rank_level: 5 },
    admin
  ).ok,
  "create while muted"
);
assert(gradeMsgs(manager).length === beforeMute, "muted other suppresses grade message");

console.log(`Job grade create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
