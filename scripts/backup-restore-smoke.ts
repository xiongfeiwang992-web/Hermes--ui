import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const dbPath = path.resolve("data", "backup-restore-smoke.db");
const app = createApp(seedDatabase(dbPath).dbPath);
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

const admin = login("admin");
const agent = login("agent_a");

assert(!app.call("system.backup.restore", { filename: "x.db" }, agent).ok, "agent cannot restore");

const keep = app.call(
  "house.create",
  {
    title: "恢复前保留房源",
    deal_type: "sale",
    community: "备份苑",
    price: 100,
    owner_name: "业主",
    owner_phone: "13770001001",
    status: "available",
  },
  agent
);
assert(keep.ok, "create keep house");
const keepId = data<any>(keep).id;

const backup = app.call("system.backup.create", {}, admin);
assert(backup.ok, "create backup snapshot");
const backupFile = data<any>(backup).filename;
assert(fs.existsSync(data<any>(backup).path), "backup file on disk");

const gone = app.call(
  "house.create",
  {
    title: "恢复后应消失房源",
    deal_type: "sale",
    community: "备份苑",
    price: 200,
    owner_name: "业主乙",
    owner_phone: "13770001002",
    status: "available",
  },
  agent
);
assert(gone.ok, "create post-backup house");
const goneId = data<any>(gone).id;
assert(
  data<any[]>(app.call("house.list", {}, agent)).some((row) => row.id === goneId),
  "post-backup house visible before restore"
);

assert(
  !app.call("system.backup.restore", { filename: "../evil.db" }, admin).ok,
  "reject path traversal filename"
);
assert(
  !app.call("system.backup.restore", { filename: "missing-file.db" }, admin).ok,
  "reject missing backup"
);

const restored = app.call("system.backup.restore", { filename: backupFile }, admin);
assert(restored.ok, "admin restore backup");
const safety = data<any>(restored).safety_backup;
assert(typeof safety === "string" && safety.startsWith("pre-restore-"), "safety backup name");
assert(
  fs.existsSync(path.resolve("data", "backups", safety)),
  "safety backup exists on disk"
);

const houses = data<any[]>(app.call("house.list", {}, agent));
assert(
  houses.some((row) => row.id === keepId && row.title === "恢复前保留房源"),
  "keep house present after restore"
);
assert(!houses.some((row) => row.id === goneId), "post-backup house removed by restore");

const listed = data<any[]>(app.call("system.backup.list", {}, admin));
assert(
  listed.some((row) => row.filename === backupFile) &&
    listed.some((row) => row.filename === safety),
  "list includes original and safety backups"
);

const me = app.call("auth.me", {}, admin);
assert(me.ok, "admin session still valid after restore");

console.log(`Backup restore smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
