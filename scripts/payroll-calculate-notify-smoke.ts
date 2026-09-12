import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "payroll-calculate-notify-smoke.db")).dbPath
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
const calcMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "payroll" && m.title === "工资批次已核算"
  );

const admin = login("admin");
const finance = login("finance");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const periodMonth = new Date().toISOString().slice(0, 7);

assert(
  app.call(
    "payroll.profiles.save",
    {
      user_id: agentAId,
      base_salary: 5000,
      fixed_allowance: 500,
      fixed_deduction: 100,
      bank_name: "测试银行",
      bank_account: "6222000011112222",
    },
    admin
  ).ok,
  "save profile A"
);
assert(
  app.call(
    "payroll.profiles.save",
    {
      user_id: agentBId,
      base_salary: 4000,
      fixed_allowance: 200,
      fixed_deduction: 0,
      bank_name: "测试银行",
      bank_account: "6222000033334444",
    },
    admin
  ).ok,
  "save profile B"
);

const batch = app.call(
  "payroll.batches.create",
  { payroll_month: periodMonth },
  admin
);
assert(batch.ok, "create batch");
const batchId = data<any>(batch).id;

assert(
  !app.call("payroll.batches.calculate", { id: batchId }, admin).ok,
  "admin cannot calculate"
);

const beforeAdmin = calcMsgs(admin).length;
const beforeFinance = calcMsgs(finance).length;
const calculated = app.call("payroll.batches.calculate", { id: batchId }, finance);
assert(calculated.ok, "finance calculates");
assert(data<any>(calculated).employees === 2, "two employees");
assert(calcMsgs(admin).length === beforeAdmin + 1, "admin receives calculated message");
assert(calcMsgs(finance).length === beforeFinance, "finance actor does not self-notify");
assert(
  calcMsgs(admin).some(
    (m) =>
      m.ref_id === batchId &&
      String(m.body).includes(periodMonth) &&
      String(m.body).includes("2 人待审批")
  ),
  "calculated message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, admin).ok,
  "mute hr"
);
const beforeMute = calcMsgs(admin).length;
assert(
  app.call("payroll.batches.calculate", { id: batchId }, finance).ok,
  "recalculate while muted"
);
assert(calcMsgs(admin).length === beforeMute, "muted hr suppresses calculated message");

console.log(
  `Payroll calculate notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
