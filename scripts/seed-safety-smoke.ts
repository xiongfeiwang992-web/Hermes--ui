import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

fs.mkdirSync("data", { recursive: true });
const directory = fs.mkdtempSync(path.resolve("data", "seed-safety-"));
const dbPath = path.join(directory, "app.db");
const seed = () => spawnSync(process.execPath, [require.resolve("tsx/cli"), "scripts/seed.ts"], {
  cwd: process.cwd(), env: { ...process.env, WEILAIJIA_DB: dbPath }, encoding: "utf8", timeout: 15000,
});
assert.equal(seed().status, 0, "first initialization succeeds");
const before = fs.readFileSync(dbPath);
const repeated = seed();
assert.notEqual(repeated.status, 0, "CLI refuses to reset an existing database");
assert.deepEqual(fs.readFileSync(dbPath), before, "existing database bytes remain unchanged");
console.log("Seed safety: first initialization passes; existing data is preserved.");
