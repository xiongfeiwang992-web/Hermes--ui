import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "care-task-complete-notify-smoke.db")).dbPath
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
const completeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "customer_care" &&
      (m.title === "客户回访已完成" || m.title === "满意度调查已完成")
  );

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const customer = app.call(
  "customer.create",
  { name: "完成通知客", phone: "13824001001", intent: "buy" },
  agentA
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const survey = app.call(
  "customerCare.tasks.create",
  {
    customer_id: customerId,
    task_type: "survey",
    purpose: "成交后满意度调查",
    assignee_user_id: agentBId,
    due_at: "2026-09-20T10:00",
  },
  manager
);
assert(survey.ok, "manager creates survey");
const surveyId = data<any>(survey).id;

assert(
  !app.call(
    "customerCare.tasks.complete",
    { id: surveyId, result: "完成", satisfaction_score: 0 },
    agentB
  ).ok,
  "survey requires valid score"
);

const beforeManager = completeMsgs(manager).length;
const beforeAgentB = completeMsgs(agentB).length;
const completed = app.call(
  "customerCare.tasks.complete",
  {
    id: surveyId,
    result: "客户表示满意",
    satisfaction_score: 5,
  },
  agentB
);
assert(completed.ok, "assignee completes survey");
assert(data<any>(completed).status === "completed", "status completed");
assert(completeMsgs(manager).length === beforeManager + 1, "creator receives complete message");
assert(completeMsgs(agentB).length === beforeAgentB, "completer does not self-notify");
assert(
  completeMsgs(manager).some(
    (m) =>
      m.ref_id === surveyId &&
      m.title === "满意度调查已完成" &&
      String(m.body).includes("成交后满意度调查") &&
      String(m.body).includes("客户表示满意") &&
      String(m.body).includes("满意度 5")
  ),
  "survey message has purpose result score"
);
assert(
  !app.call(
    "customerCare.tasks.complete",
    { id: surveyId, result: "再次完成", satisfaction_score: 4 },
    agentB
  ).ok,
  "cannot complete twice"
);

const customer2 = app.call(
  "customer.create",
  { name: "回访完成客", phone: "13824001002", intent: "buy" },
  agentA
);
assert(customer2.ok, "create callback customer");
const callback = app.call(
  "customerCare.tasks.create",
  {
    customer_id: data<any>(customer2).id,
    task_type: "callback",
    purpose: "售后回访跟进",
    assignee_user_id: agentBId,
    due_at: "2026-09-21T10:00",
  },
  manager
);
assert(callback.ok, "create callback task");
const callbackId = data<any>(callback).id;
const beforeCb = completeMsgs(manager).length;
assert(
  app.call(
    "customerCare.tasks.complete",
    { id: callbackId, result: "已电话回访确认" },
    agentB
  ).ok,
  "complete callback"
);
assert(
  completeMsgs(manager).some(
    (m) => m.ref_id === callbackId && m.title === "客户回访已完成"
  ),
  "callback complete title"
);
assert(completeMsgs(manager).length === beforeCb + 1, "callback notifies creator");

const customer3 = app.call(
  "customer.create",
  { name: "静音完成客", phone: "13824001003", intent: "buy" },
  agentA
);
assert(customer3.ok, "create muted customer");
const muted = app.call(
  "customerCare.tasks.create",
  {
    customer_id: data<any>(customer3).id,
    task_type: "survey",
    purpose: "静音调查",
    assignee_user_id: agentBId,
    due_at: "2026-09-22T10:00",
  },
  manager
);
assert(muted.ok, "create muted survey");
assert(
  app.call("message.subscriptions.save", { channels: { care: false } }, manager).ok,
  "mute care channel"
);
const beforeMute = completeMsgs(manager).length;
assert(
  app.call(
    "customerCare.tasks.complete",
    {
      id: data<any>(muted).id,
      result: "静音完成",
      satisfaction_score: 3,
    },
    agentB
  ).ok,
  "complete while creator muted"
);
assert(completeMsgs(manager).length === beforeMute, "muted care suppresses complete message");

console.log(
  `Care task complete notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
