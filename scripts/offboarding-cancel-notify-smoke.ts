import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "offboarding-cancel-notify-smoke.db")).dbPath
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
    (m) => m.kind === "offboarding" && m.title === "离职交接已取消"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

const task = app.call(
  "offboarding.start",
  {
    user_id: agentAId,
    target_user_id: agentBId,
    reason: "取消通知测试离职",
  },
  manager
);
assert(task.ok, "manager starts offboarding task");
const taskId = data<any>(task).id;

assert(
  data<any[]>(app.call("message.list", {}, agentB)).some(
    (m) => m.ref_id === taskId && m.title === "收到离职交接任务"
  ),
  "target received start message"
);

assert(
  !app.call("offboarding.cancel", { id: taskId, reason: "" }, admin).ok,
  "cancel requires reason"
);
assert(
  !app.call(
    "offboarding.cancel",
    { id: taskId, reason: "经纪人不可取消" },
    agentB
  ).ok,
  "target cannot cancel task"
);

const beforeTarget = cancelMsgs(agentB).length;
const beforeAdmin = cancelMsgs(admin).length;
const beforeManager = cancelMsgs(manager).length;
const cancelled = app.call(
  "offboarding.cancel",
  { id: taskId, reason: "暂缓离职安排" },
  admin
);
assert(cancelled.ok, "admin cancels pending offboarding");

const afterTarget = cancelMsgs(agentB);
assert(afterTarget.length === beforeTarget + 1, "target receives cancel message");
assert(afterTarget[0].ref_id === taskId, "message refs task");
assert(String(afterTarget[0].body).includes("经纪人甲"), "body has employee name");
assert(String(afterTarget[0].body).includes("暂缓离职安排"), "body has reason");
assert(cancelMsgs(admin).length === beforeAdmin, "admin canceller does not self-notify");
assert(cancelMsgs(manager).length === beforeManager, "creator not messaged on cancel");
assert(
  !app.call("offboarding.cancel", { id: taskId, reason: "再次取消" }, admin).ok,
  "cannot cancel twice"
);
assert(
  data<any[]>(app.call("org.users.list", {}, admin)).some(
    (u) => u.id === agentAId && u.status === "active"
  ),
  "employee remains active after cancel"
);

const task2 = app.call(
  "offboarding.start",
  {
    user_id: agentAId,
    target_user_id: managerId,
    reason: "店长自接取消测",
  },
  admin
);
assert(task2.ok, "admin starts second task to manager");
const beforeSelf = cancelMsgs(manager).length;
assert(
  app.call(
    "offboarding.cancel",
    { id: data<any>(task2).id, reason: "接收人自行取消" },
    manager
  ).ok,
  "manager cancels task targeting self"
);
assert(
  cancelMsgs(manager).length === beforeSelf,
  "self-target cancel does not self-notify"
);

const task3 = app.call(
  "offboarding.start",
  {
    user_id: agentAId,
    target_user_id: agentBId,
    reason: "静音取消测",
  },
  manager
);
assert(task3.ok, "create mute-test task");
assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, agentB).ok,
  "mute hr channel"
);
const beforeMute = cancelMsgs(agentB).length;
assert(
  app.call(
    "offboarding.cancel",
    { id: data<any>(task3).id, reason: "静音场景取消" },
    admin
  ).ok,
  "cancel while target muted"
);
assert(cancelMsgs(agentB).length === beforeMute, "muted hr suppresses cancel message");

console.log(`Offboarding cancel notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
