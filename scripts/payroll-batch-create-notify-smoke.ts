import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "payroll-batch-create-notify-smoke.db")).dbPath
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
const createMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "payroll" && m.title === "工资批次已创建"
  );

const admin = login("admin");
const finance = login("finance");
const manager = login("manager");
const periodMonth = new Date().toISOString().slice(0, 7);

assert(
  !app.call("payroll.batches.create", { payroll_month: periodMonth }, finance).ok,
  "finance cannot create batch"
);
assert(
  !app.call("payroll.batches.create", { payroll_month: "2026-13" }, admin).ok,
  "invalid month rejected"
);

const beforeFinance = createMsgs(finance).length;
const beforeAdmin = createMsgs(admin).length;
const beforeManager = createMsgs(manager).length;
const batch = app.call(
  "payroll.batches.create",
  { payroll_month: periodMonth },
  admin
);
assert(batch.ok, "admin creates batch");
assert(data<any>(batch).status === "draft", "status draft");
const batchId = data<any>(batch).id;
assert(createMsgs(finance).length === beforeFinance + 1, "finance receives create message");
assert(createMsgs(admin).length === beforeAdmin, "admin actor does not self-notify");
assert(createMsgs(manager).length === beforeManager, "manager does not receive");
assert(
  createMsgs(finance).some(
    (m) =>
      m.ref_id === batchId &&
      String(m.body).includes(periodMonth) &&
      String(m.body).includes("草稿待核算")
  ),
  "create message body"
);
assert(
  !app.call("payroll.batches.create", { payroll_month: periodMonth }, admin).ok,
  "duplicate month blocked"
);

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, finance).ok,
  "mute hr"
);
const nextMonth = periodMonth.endsWith("12")
  ? `${Number(periodMonth.slice(0, 4)) + 1}-01`
  : `${periodMonth.slice(0, 5)}${String(Number(periodMonth.slice(5)) + 1).padStart(2, "0")}`;
const beforeMute = createMsgs(finance).length;
assert(
  app.call("payroll.batches.create", { payroll_month: nextMonth }, admin).ok,
  "create next month while muted"
);
assert(createMsgs(finance).length === beforeMute, "muted hr suppresses create message");

console.log(
  `Payroll batch create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
