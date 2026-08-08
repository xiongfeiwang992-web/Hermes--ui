import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "offboarding-smoke.db")).dbPath);
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
const agentC = login("agent_c");
const managerId = data<any>(app.call("auth.me", {}, manager)).id;
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const agentCId = data<any>(app.call("auth.me", {}, agentC)).id;

const house = app.call(
  "house.create",
  {
    title: "离职交接房源",
    deal_type: "sale",
    community: "交接小区",
    price: 190,
    owner_name: "交接业主",
    owner_phone: "13720000001",
    status: "available",
  },
  agentA
);
check(house.ok, "create offboarding house");
const houseId = data<any>(house).id;
const customer = app.call(
  "customer.create",
  { name: "离职交接客户", phone: "13820000001", intent: "buy" },
  agentA
);
check(customer.ok, "create offboarding customer");
const customerId = data<any>(customer).id;
const key = app.call(
  "property.keys.register",
  { house_id: houseId, key_no: "OFF-KEY-001" },
  agentA
);
check(key.ok, "register offboarding key");
check(
  app.call(
    "property.keys.borrow",
    { id: data<any>(key).id, borrower_user_id: agentAId },
    agentA
  ).ok,
  "borrow key before offboarding"
);
check(
  app.call(
    "house.roles.assign",
    { house_id: houseId, role_type: "photographer", user_id: agentAId },
    manager
  ).ok,
  "assign house role before offboarding"
);

const preview = app.call("offboarding.preview", { user_id: agentAId }, manager);
check(
  preview.ok &&
    data<any>(preview).houses.length === 1 &&
    data<any>(preview).customers.length === 1 &&
    data<any>(preview).keys.length === 1 &&
    data<any>(preview).roles.length === 1,
  "preview employee houses customers keys and roles"
);
check(
  !app.call(
    "offboarding.start",
    {
      user_id: agentAId,
      target_user_id: agentCId,
      reason: "员工主动离职",
    },
    manager
  ).ok,
  "reject cross-store handover target"
);
check(
  !app.call(
    "offboarding.start",
    {
      user_id: agentAId,
      target_user_id: agentAId,
      reason: "员工主动离职",
    },
    manager
  ).ok,
  "reject self handover"
);
const task = app.call(
  "offboarding.start",
  {
    user_id: agentAId,
    target_user_id: agentBId,
    reason: "员工主动离职",
  },
  manager
);
check(task.ok, "create pending offboarding task");
const taskId = data<any>(task).id;
check(
  !app.call(
    "offboarding.start",
    {
      user_id: agentAId,
      target_user_id: agentBId,
      reason: "重复任务",
    },
    manager
  ).ok,
  "prevent duplicate pending offboarding task"
);
check(app.call("auth.me", {}, agentA).ok, "employee session active before execution");
const executed = app.call("offboarding.execute", { id: taskId }, manager);
check(
  executed.ok &&
    data<any>(executed).houses === 1 &&
    data<any>(executed).customers === 1 &&
    data<any>(executed).keys === 1 &&
    data<any>(executed).roles === 1,
  "execute transactional asset handover"
);
check(!app.call("auth.me", {}, agentA).ok, "employee sessions invalidated");
check(
  !app.call("auth.login", { account: "agent_a", password: "123456" }).ok,
  "inactive employee cannot log in"
);
check(
  data<any>(app.call("house.get", { id: houseId }, agentB)).agent_id === agentBId,
  "house transferred to receiver"
);
check(
  data<any>(app.call("customer.get", { id: customerId }, agentB)).agent_id === agentBId,
  "customer transferred to receiver"
);
const keys = app.call("property.keys.list", { house_id: houseId }, agentB);
check(
  keys.ok &&
    data<any[]>(keys)[0].status === "stored" &&
    data<any[]>(keys)[0].borrower_user_id == null &&
    data<any[]>(keys)[0].keeper_user_id === agentBId,
  "borrowed key returned and keeper transferred"
);
const roles = app.call("house.roles.list", { house_id: houseId }, agentB);
check(
  roles.ok && data<any[]>(roles).some((role) => role.user_id === agentBId),
  "house role transferred to receiver"
);
const tasks = app.call("offboarding.list", { status: "completed" }, manager);
check(
  tasks.ok && data<any[]>(tasks).some((item) => item.id === taskId),
  "completed task retained with snapshot counts"
);
const messages = app.call("message.list", {}, agentB);
check(
  messages.ok && data<any[]>(messages).some((message) => message.kind === "offboarding"),
  "receiver gets handover messages"
);
check(
  !app.call("offboarding.execute", { id: taskId }, manager).ok,
  "completed handover cannot execute twice"
);

const cancelledTask = app.call(
  "offboarding.start",
  {
    user_id: agentBId,
    target_user_id: managerId,
    reason: "测试取消交接",
  },
  admin
);
check(cancelledTask.ok, "admin creates cancellable handover");
check(
  !app.call(
    "offboarding.cancel",
    { id: data<any>(cancelledTask).id, reason: "" },
    admin
  ).ok,
  "offboarding cancellation requires reason"
);
check(
  app.call(
    "offboarding.cancel",
    { id: data<any>(cancelledTask).id, reason: "员工决定留任" },
    admin
  ).ok,
  "cancel pending offboarding task"
);
check(app.call("auth.me", {}, agentB).ok, "cancelled task leaves employee active");

console.log(`Offboarding smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
