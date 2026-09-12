import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "backup-create-notify-smoke.db")).dbPath
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
const backupMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "数据库备份已完成"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call("system.backup.create", {}, manager).ok,
  "manager cannot create backup"
);

const beforeAdmin = backupMsgs(admin).length;
const beforeManager = backupMsgs(manager).length;
const beforeAgent = backupMsgs(agent).length;
const created = app.call("system.backup.create", {}, admin);
assert(created.ok, "admin creates backup");
const filename = data<any>(created).filename;
const size = data<any>(created).size;
assert(Boolean(filename), "backup filename present");
assert(Number(size) > 0, "backup size positive");
assert(backupMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(
  backupMsgs(manager).length === beforeManager + 1,
  "manager receives backup message"
);
assert(backupMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  backupMsgs(manager).some(
    (m) =>
      m.ref_id === filename &&
      m.ref_type === "database_backup" &&
      String(m.body).includes(filename) &&
      String(m.body).includes(String(size))
  ),
  "backup message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = backupMsgs(manager).length;
assert(app.call("system.backup.create", {}, admin).ok, "create while muted");
assert(backupMsgs(manager).length === beforeMute, "muted other suppresses backup message");

console.log(`Backup create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
