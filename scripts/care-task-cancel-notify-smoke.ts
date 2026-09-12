import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "care-task-cancel-notify-smoke.db")).dbPath
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
const cancelMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "customer_care" && m.title === "客户关怀任务已取消"
  );

const agentA = login("agent_a");
const agentB = login("agent_b");
const manager = login("manager");
const agentBUser = data<any>(app.call("auth.me", {}, agentB));

const customer = app.call(
  "customer.create",
  { name: "取消通知关怀客", phone: "13832001001", intent: "buy" },
  agentA
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const task = app.call(
  "customerCare.tasks.create",
  {
    customer_id: customerId,
    task_type: "callback",
    purpose: "例行回访",
    assignee_user_id: agentBUser.id,
    due_at: "2026-09-01T10:00",
  },
  manager
);
assert(task.ok, "manager creates callback assigned to agent_b");
const taskId = data<any>(task).id;

const beforeB = cancelMsgs(agentB).length;
const beforeManager = cancelMsgs(manager).length;

assert(
  !app.call("customerCare.tasks.cancel", { id: taskId, reason: "" }, manager).ok,
  "cancel requires reason"
);
assert(
  !app.call(
    "customerCare.tasks.cancel",
    { id: taskId, reason: "越权" },
    agentB
  ).ok,
  "assignee cannot cancel"
);

const cancelled = app.call(
  "customerCare.tasks.cancel",
  { id: taskId, reason: "客户要求改期" },
  manager
);
assert(cancelled.ok, "manager cancels task");
assert(data<any>(cancelled).status === "cancelled", "status cancelled");
assert(data<any>(cancelled).cancel_reason === "客户要求改期", "cancel_reason returned");

const afterB = cancelMsgs(agentB);
assert(afterB.length === beforeB + 1, "assignee receives cancel message");
assert(afterB[0].ref_id === taskId, "message refs task");
assert(String(afterB[0].body).includes("取消通知关怀客"), "body has customer name");
assert(String(afterB[0].body).includes("客户回访"), "body has task type label");
assert(String(afterB[0].body).includes("客户要求改期"), "body has reason");
assert(cancelMsgs(manager).length === beforeManager, "canceller does not self-notify");

assert(
  !app.call(
    "customerCare.tasks.cancel",
    { id: taskId, reason: "再次取消" },
    manager
  ).ok,
  "cannot cancel twice"
);

const selfTask = app.call(
  "customerCare.tasks.create",
  {
    customer_id: customerId,
    task_type: "callback",
    purpose: "本人回访",
    due_at: "2026-09-02T10:00",
  },
  agentA
);
assert(selfTask.ok, "agent creates self-assigned callback");
const beforeSelf = cancelMsgs(agentA).length;
assert(
  app.call(
    "customerCare.tasks.cancel",
    { id: data<any>(selfTask).id, reason: "本人取消" },
    agentA
  ).ok,
  "creator cancels own self-assigned task"
);
assert(cancelMsgs(agentA).length === beforeSelf, "self-assigned cancel skips notify");

const mutedTask = app.call(
  "customerCare.tasks.create",
  {
    customer_id: customerId,
    task_type: "survey",
    purpose: "静音调查",
    assignee_user_id: agentBUser.id,
    due_at: "2026-09-03T10:00",
  },
  manager
);
assert(mutedTask.ok, "create survey for mute test");
assert(
  app.call("message.subscriptions.save", { channels: { care: false } }, agentB).ok,
  "mute care channel"
);
const beforeMute = cancelMsgs(agentB).length;
assert(
  app.call(
    "customerCare.tasks.cancel",
    { id: data<any>(mutedTask).id, reason: "静音取消" },
    manager
  ).ok,
  "cancel while muted"
);
assert(cancelMsgs(agentB).length === beforeMute, "muted care suppresses cancel message");

console.log(`Care task cancel notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
