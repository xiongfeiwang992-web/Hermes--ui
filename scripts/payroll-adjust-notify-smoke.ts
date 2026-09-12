import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "payroll-adjust-notify-smoke.db")).dbPath
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
const adjustMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "payroll" && String(m.title).endsWith("工资条已调整")
  );

const admin = login("admin");
const finance = login("finance");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

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
  "save agent_a profile"
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
  "save agent_b profile"
);

const batch = app.call("payroll.batches.create", { payroll_month: "2026-09" }, admin);
assert(batch.ok, "create payroll batch");
const batchId = data<any>(batch).id;
assert(
  app.call("payroll.batches.calculate", { id: batchId }, finance).ok,
  "calculate payroll batch"
);

const items = data<any[]>(app.call("payroll.items.list", { batch_id: batchId }, finance));
const agentAItem = items.find((item) => item.user_id === agentAId);
const agentBItem = items.find((item) => item.user_id === agentBId);
assert(Boolean(agentAItem && agentBItem), "both payroll items present");

assert(
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
  "admin cannot adjust"
);
assert(
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
  "adjust requires reason"
);

const beforeA = adjustMsgs(agentA).length;
const beforeB = adjustMsgs(agentB).length;
const beforeFinance = adjustMsgs(finance).length;
const adjusted = app.call(
  "payroll.items.adjust",
  {
    id: agentAItem.id,
    allowance: 600,
    bonus: 500,
    deduction: 100,
    tax: 100,
    reason: "绩效奖金",
  },
  finance
);
assert(adjusted.ok, "finance adjusts agent_a item");
assert(data<any>(adjusted).net_amount === 5900, "net amount recalculated");

const afterA = adjustMsgs(agentA);
assert(afterA.length === beforeA + 1, "employee receives adjust message");
assert(afterA[0].ref_id === agentAItem.id, "message refs payroll item");
assert(afterA[0].title === "2026-09 工资条已调整", "title has payroll month");
assert(String(afterA[0].body).includes("5900.00"), "body has net amount");
assert(String(afterA[0].body).includes("绩效奖金"), "body has reason");
assert(adjustMsgs(agentB).length === beforeB, "other employee not notified");
assert(adjustMsgs(finance).length === beforeFinance, "finance does not self-notify");

const second = app.call(
  "payroll.items.adjust",
  {
    id: agentAItem.id,
    allowance: 700,
    bonus: 500,
    deduction: 100,
    tax: 100,
    reason: "再次调整津贴",
  },
  finance
);
assert(second.ok, "finance adjusts again");
assert(adjustMsgs(agentA).length === afterA.length + 1, "second adjust re-notifies");

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, agentB).ok,
  "mute hr channel"
);
const beforeMute = adjustMsgs(agentB).length;
assert(
  app.call(
    "payroll.items.adjust",
    {
      id: agentBItem.id,
      allowance: 300,
      bonus: 0,
      deduction: 0,
      tax: 50,
      reason: "静音调整",
    },
    finance
  ).ok,
  "adjust while employee muted"
);
assert(adjustMsgs(agentB).length === beforeMute, "muted hr suppresses adjust message");

console.log(`Payroll adjust notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
