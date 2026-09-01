import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "job-grade-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "职级已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const created = app.call(
  "workforce.grades.save",
  {
    code: "UG1",
    name: "更新初级职级",
    rank_level: 3,
    applicable_role: "agent",
  },
  admin
);
assert(created.ok, "admin creates job grade");
const gradeId = data<any>(created).id;

assert(
  !app.call(
    "workforce.grades.save",
    {
      id: gradeId,
      code: "UG1",
      name: "店长不可改",
      rank_level: 4,
    },
    manager
  ).ok,
  "manager cannot update job grade"
);

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "workforce.grades.save",
  {
    id: gradeId,
    code: "UG1",
    name: "更新初级职级改",
    rank_level: 4,
    applicable_role: "agent",
  },
  admin
);
assert(updated.ok, "admin updates job grade");
assert(updateMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(updateMsgs(manager).length === beforeManager + 1, "manager receives update message");
assert(updateMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === gradeId &&
      m.ref_type === "job_grade" &&
      String(m.body).includes("更新初级职级改") &&
      String(m.body).includes("UG1") &&
      String(m.body).includes("L4")
  ),
  "update message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = updateMsgs(manager).length;
assert(
  app.call(
    "workforce.grades.save",
    {
      id: gradeId,
      code: "UG1",
      name: "静音职级更新",
      rank_level: 5,
      applicable_role: "agent",
    },
    admin
  ).ok,
  "update while muted"
);
assert(updateMsgs(manager).length === beforeMute, "muted other suppresses update message");

console.log(`Job grade update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
