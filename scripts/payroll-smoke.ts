import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "payroll-smoke.db")).dbPath);
let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentC = login("agent_c");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

check(
  data<any>(app.call("payroll.options", {}, agentA)).users.length === 1,
  "employee payroll options restricted to self"
);
check(
  data<any>(app.call("payroll.options", {}, admin)).users.length === 5,
  "admin payroll options include active non-admin employees"
);
check(
  !app.call(
    "payroll.profiles.save",
    {
      user_id: agentAId,
      base_salary: 5000,
      fixed_allowance: 500,
      fixed_deduction: 100,
      bank_name: "测试银行",
      bank_account: "6222000011112222",
    },
    finance
  ).ok,
  "only admin can save salary profile"
);
check(
  !app.call(
    "payroll.profiles.save",
    {
      user_id: agentAId,
      base_salary: -1,
      fixed_allowance: 0,
      fixed_deduction: 0,
      bank_name: "测试银行",
      bank_account: "6222",
    },
    admin
  ).ok,
  "salary profile rejects negative amounts"
);
check(
  !app.call(
    "payroll.profiles.save",
    {
      user_id: agentAId,
      base_salary: 5000,
      fixed_allowance: 0,
      fixed_deduction: 0,
      bank_name: "",
      bank_account: "",
    },
    admin
  ).ok,
  "salary profile requires payment bank"
);
check(
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
  "admin saves first salary profile"
);
check(
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
  "admin saves second salary profile"
);
const ownProfile = app.call("payroll.profiles.list", {}, agentA);
check(
  ownProfile.ok &&
    data<any[]>(ownProfile).length === 1 &&
    data<any[]>(ownProfile)[0].bank_account === "****2222",
  "employee sees only own profile with masked bank account"
);
check(
  data<any[]>(app.call("payroll.profiles.list", {}, manager)).length === 0,
  "manager cannot see employee salary profiles"
);
check(
  data<any[]>(app.call("payroll.profiles.list", {}, finance)).length === 2,
  "finance sees company salary profiles"
);
check(
  !app.call("payroll.batches.create", { payroll_month: "2026-13" }, admin).ok,
  "payroll month validated"
);
const batch = app.call(
  "payroll.batches.create",
  { payroll_month: "2026-08" },
  admin
);
check(batch.ok && data<any>(batch).status === "draft", "admin creates payroll batch");
const batchId = data<any>(batch).id;
check(
  !app.call(
    "payroll.batches.create",
    { payroll_month: "2026-08" },
    admin
  ).ok,
  "payroll month unique"
);
check(
  !app.call("payroll.batches.calculate", { id: batchId }, admin).ok,
  "only finance can calculate payroll"
);
const calculated = app.call(
  "payroll.batches.calculate",
  { id: batchId },
  finance
);
check(
  calculated.ok && data<any>(calculated).employees === 2,
  "finance calculates payroll from active profiles"
);
check(
  data<any[]>(app.call("payroll.batches.list", {}, agentA)).length === 0,
  "employee cannot see unapproved payroll batch"
);
check(
  !app.call("payroll.items.list", { batch_id: batchId }, agentA).ok,
  "employee cannot see unpublished payslip"
);
const items = app.call("payroll.items.list", { batch_id: batchId }, finance);
check(items.ok && data<any[]>(items).length === 2, "finance lists calculated payroll items");
const agentAItem = data<any[]>(items).find((item) => item.user_id === agentAId);
check(
  agentAItem.gross_amount === 5500 && agentAItem.net_amount === 5400,
  "initial payroll formula uses profile snapshot"
);
check(
  !app.call(
    "payroll.items.adjust",
    {
      id: agentAItem.id,
      allowance: 600,
      bonus: 500,
      deduction: 100,
      tax: 100,
      reason: "绩效奖金",
    },
    admin
  ).ok,
  "only finance can adjust payroll item"
);
check(
  !app.call(
    "payroll.items.adjust",
    {
      id: agentAItem.id,
      allowance: 600,
      bonus: 500,
      deduction: 100,
      tax: 100,
      reason: "",
    },
    finance
  ).ok,
  "payroll adjustment requires reason"
);
check(
  !app.call(
    "payroll.items.adjust",
    {
      id: agentAItem.id,
      allowance: 0,
      bonus: 0,
      deduction: 99999,
      tax: 0,
      reason: "超额扣款",
    },
    finance
  ).ok,
  "deduction cannot exceed gross salary"
);
const adjusted = app.call(
  "payroll.items.adjust",
  {
    id: agentAItem.id,
    allowance: 600,
    bonus: 500,
    deduction: 100,
    tax: 100,
    reason: "绩效奖金及个税",
  },
  finance
);
check(
  adjusted.ok &&
    data<any>(adjusted).gross_amount === 6100 &&
    data<any>(adjusted).net_amount === 5900,
  "finance adjusts payroll and recalculates net amount"
);
const calculatedBatch = data<any[]>(app.call("payroll.batches.list", {}, finance)).find(
  (item) => item.id === batchId
);
check(
  calculatedBatch.gross_total === 10300 && calculatedBatch.net_total === 10100,
  "batch totals recalculate after adjustment"
);
check(
  !app.call("payroll.batches.approve", { id: batchId }, finance).ok,
  "finance cannot approve payroll"
);
check(
  app.call("payroll.batches.approve", { id: batchId }, admin).ok,
  "admin approves calculated payroll"
);
check(
  !app.call(
    "payroll.items.adjust",
    {
      id: agentAItem.id,
      allowance: 600,
      bonus: 600,
      deduction: 100,
      tax: 100,
      reason: "审批后调整",
    },
    finance
  ).ok,
  "approved payroll items are immutable"
);
check(
  data<any[]>(app.call("payroll.batches.list", {}, agentA)).length === 1,
  "employee sees approved payroll batch"
);
const ownItems = app.call("payroll.items.list", { batch_id: batchId }, agentA);
check(
  ownItems.ok &&
    data<any[]>(ownItems).length === 1 &&
    data<any[]>(ownItems)[0].net_amount === 5900,
  "employee sees only own approved payslip"
);
check(
  data<any[]>(app.call("payroll.items.list", { batch_id: batchId }, agentC)).length === 0,
  "employee without profile sees no other payslips"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.kind === "payroll"
  ),
  "employee receives payslip publication message"
);
check(
  !app.call(
    "payroll.batches.pay",
    { id: batchId, payment_reference: "PAYROLL-202608" },
    admin
  ).ok,
  "only finance can register payroll payment"
);
check(
  !app.call(
    "payroll.batches.pay",
    { id: batchId, payment_reference: "" },
    finance
  ).ok,
  "payroll payment requires reference"
);
check(
  app.call(
    "payroll.batches.pay",
    { id: batchId, payment_reference: "PAYROLL-202608" },
    finance
  ).ok,
  "finance registers payroll payment"
);
check(
  !app.call(
    "payroll.batches.pay",
    { id: batchId, payment_reference: "DUPLICATE" },
    finance
  ).ok,
  "paid payroll cannot be paid twice"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).filter(
    (message) => message.kind === "payroll"
  ).length >= 2,
  "employee receives payment message"
);
check(
  !app.call("payroll.export", { id: batchId }, agentA).ok,
  "employee cannot export company payroll"
);
const csv = app.call("payroll.export", { id: batchId }, finance);
check(
  csv.ok &&
    data<any>(csv).rows === 2 &&
    data<any>(csv).content.startsWith("\uFEFF") &&
    data<any>(csv).content.includes("经纪人甲"),
  "finance exports UTF-8 payroll CSV"
);
const events = app.call("payroll.events", { id: batchId }, admin);
check(
  events.ok &&
    data<any[]>(events).some((event) => event.event_type === "item_adjusted") &&
    data<any[]>(events).some((event) => event.event_type === "paid"),
  "payroll event history includes adjustment and payment"
);
check(
  !app.call("payroll.events", { id: batchId }, manager).ok,
  "manager cannot inspect payroll audit events"
);
check(
  !app.call("payroll.batches.calculate", { id: batchId }, finance).ok,
  "paid payroll cannot recalculate"
);

console.log(`Payroll smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
