import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";
import { todayDate } from "../server/utils/id";

const app = createApp(seedDatabase(path.resolve("data", "workforce-smoke.db")).dbPath);
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
const managerUser = data<any>(app.call("auth.me", {}, manager));
const agentAUser = data<any>(app.call("auth.me", {}, agentA));
const agentBUser = data<any>(app.call("auth.me", {}, agentB));
const financeUser = data<any>(app.call("auth.me", {}, finance));
const agentCUser = data<any>(app.call("auth.me", {}, agentC));
const adminOptions = app.call("workforce.options", {}, admin);
check(
  adminOptions.ok &&
    data<any>(adminOptions).stores.length === 2 &&
    data<any>(adminOptions).users.length === 6,
  "admin gets company workforce options"
);
const managerOptions = app.call("workforce.options", {}, manager);
check(
  managerOptions.ok &&
    data<any>(managerOptions).users.every(
      (employee: any) => employee.store_id === managerUser.store_id
    ),
  "manager workforce options restricted to own store employees"
);
check(!app.call("workforce.options", {}, agentA).ok, "agent cannot access workforce management");
const storeA = data<any>(adminOptions).stores.find((store: any) => store.name === "一号店").id;
const storeB = data<any>(adminOptions).stores.find((store: any) => store.name === "二号店").id;

check(
  !app.call(
    "workforce.grades.save",
    { code: "A1", name: "初级经纪人", rank_level: 1, applicable_role: "agent" },
    manager
  ).ok,
  "manager cannot create job grade"
);
check(
  !app.call(
    "workforce.grades.save",
    { code: "", name: "无效职级", rank_level: 0 },
    admin
  ).ok,
  "job grade validates required fields"
);
const agentGrade = app.call(
  "workforce.grades.save",
  {
    code: "A1",
    name: "初级经纪人",
    rank_level: 1,
    applicable_role: "agent",
    description: "经纪人基础职级",
  },
  admin
);
check(agentGrade.ok, "admin creates agent job grade");
check(
  !app.call(
    "workforce.grades.save",
    { code: "A1", name: "重复职级", rank_level: 2, applicable_role: "agent" },
    admin
  ).ok,
  "job grade code must be unique"
);
check(
  !app.call(
    "workforce.grades.assign",
    {
      user_id: agentAUser.id,
      job_grade_id: data<any>(agentGrade).id,
      reason: "",
    },
    admin
  ).ok,
  "job grade assignment requires reason"
);
check(
  !app.call(
    "workforce.grades.assign",
    {
      user_id: financeUser.id,
      job_grade_id: data<any>(agentGrade).id,
      reason: "错误角色",
    },
    admin
  ).ok,
  "job grade role compatibility enforced"
);
check(
  app.call(
    "workforce.grades.assign",
    {
      user_id: agentAUser.id,
      job_grade_id: data<any>(agentGrade).id,
      reason: "入职定级",
    },
    admin
  ).ok,
  "admin assigns compatible job grade"
);
check(
  data<any[]>(app.call("workforce.grades.list", {}, manager)).some(
    (grade) => grade.id === data<any>(agentGrade).id && grade.employee_count === 1
  ),
  "manager sees grade and employee count"
);

const house = app.call(
  "house.create",
  {
    title: "调动交接房源",
    deal_type: "sale",
    community: "调动小区",
    price: 210,
    owner_name: "调动业主",
    owner_phone: "13740000001",
    status: "available",
  },
  agentA
);
const customer = app.call(
  "customer.create",
  { name: "调动交接客户", phone: "13840000001", intent: "buy" },
  agentA
);
check(house.ok && customer.ok, "create employee assets before transfer");
const houseId = data<any>(house).id;
const customerId = data<any>(customer).id;
const key = app.call(
  "property.keys.register",
  { house_id: houseId, key_no: "TRF-KEY-001" },
  agentA
);
check(
  key.ok &&
    app.call(
      "property.keys.borrow",
      { id: data<any>(key).id, borrower_user_id: agentAUser.id },
      agentA
    ).ok,
  "register and borrow employee key"
);
check(
  app.call(
    "house.roles.assign",
    { house_id: houseId, role_type: "photographer", user_id: agentAUser.id },
    manager
  ).ok,
  "assign employee house role"
);
const preview = app.call(
  "workforce.transfers.preview",
  { user_id: agentAUser.id },
  manager
);
check(
  preview.ok &&
    data<any>(preview).houses.length === 1 &&
    data<any>(preview).customers.length === 1 &&
    data<any>(preview).keys.length === 1 &&
    data<any>(preview).roles.length === 1,
  "preview transfer assets"
);
check(
  !app.call(
    "workforce.transfers.preview",
    { user_id: managerUser.id },
    manager
  ).ok,
  "manager cannot initiate own transfer"
);
check(
  !app.call(
    "workforce.transfers.create",
    {
      user_id: agentAUser.id,
      to_store_id: storeA,
      handover_user_id: agentBUser.id,
      to_role: "agent",
      effective_date: todayDate(),
      reason: "无效同店调动",
    },
    manager
  ).ok,
  "target store must differ"
);
check(
  !app.call(
    "workforce.transfers.create",
    {
      user_id: agentAUser.id,
      to_store_id: storeB,
      handover_user_id: agentCUser.id,
      to_role: "agent",
      effective_date: todayDate(),
      reason: "跨店交接人",
    },
    manager
  ).ok,
  "handover employee must belong to source store"
);
check(
  !app.call(
    "workforce.transfers.create",
    {
      user_id: agentAUser.id,
      to_store_id: storeB,
      handover_user_id: agentBUser.id,
      to_role: "finance",
      effective_date: todayDate(),
      reason: "店长越权改角色",
    },
    manager
  ).ok,
  "manager cannot change role during transfer"
);
const transfer = app.call(
  "workforce.transfers.create",
  {
    user_id: agentAUser.id,
    to_store_id: storeB,
    handover_user_id: agentBUser.id,
    to_role: "agent",
    effective_date: todayDate(),
    reason: "支援二号店业务",
  },
  manager
);
check(
  transfer.ok &&
    data<any>(transfer).snapshot.houses.length === 1 &&
    data<any>(transfer).snapshot.customers.length === 1,
  "manager creates transfer with asset snapshot"
);
const transferId = data<any>(transfer).id;
check(
  !app.call(
    "workforce.transfers.create",
    {
      user_id: agentAUser.id,
      to_store_id: storeB,
      handover_user_id: agentBUser.id,
      to_role: "agent",
      effective_date: todayDate(),
      reason: "重复调动",
    },
    manager
  ).ok,
  "prevent duplicate active transfer"
);
check(
  data<any[]>(app.call("message.list", {}, admin)).some(
    (message) => message.kind === "employee_transfer"
  ),
  "admin receives transfer approval message"
);
check(
  !app.call(
    "workforce.transfers.review",
    { id: transferId, status: "approved" },
    manager
  ).ok,
  "only admin can approve transfer"
);
check(
  app.call(
    "workforce.transfers.review",
    { id: transferId, status: "approved" },
    admin
  ).ok,
  "admin approves transfer"
);
check(app.call("auth.me", {}, agentA).ok, "employee session active before execution");
const executed = app.call("workforce.transfers.execute", { id: transferId }, admin);
check(
  executed.ok &&
    data<any>(executed).houses === 1 &&
    data<any>(executed).customers === 1 &&
    data<any>(executed).keys === 1 &&
    data<any>(executed).roles === 1,
  "execute transfer and original-store asset handover"
);
check(!app.call("auth.me", {}, agentA).ok, "transfer invalidates employee sessions");
const movedAgent = login("agent_a");
check(
  data<any>(app.call("auth.me", {}, movedAgent)).store_id === storeB,
  "employee relogin reflects target store"
);
check(
  data<any>(app.call("house.get", { id: houseId }, agentB)).agent_id === agentBUser.id,
  "house handed to source-store receiver"
);
check(
  data<any>(app.call("customer.get", { id: customerId }, agentB)).agent_id === agentBUser.id,
  "customer handed to source-store receiver"
);
const keys = app.call("property.keys.list", { house_id: houseId }, agentB);
check(
  keys.ok &&
    data<any[]>(keys)[0].status === "stored" &&
    data<any[]>(keys)[0].keeper_user_id === agentBUser.id,
  "borrowed key returned and keeper transferred"
);
check(
  data<any[]>(app.call("house.roles.list", { house_id: houseId }, agentB)).some(
    (role) => role.user_id === agentBUser.id
  ),
  "house role handed to receiver"
);
check(
  data<any>(app.call("workforce.options", {}, admin)).users.find(
    (employee: any) => employee.id === agentAUser.id
  ).job_grade_id === data<any>(agentGrade).id,
  "compatible job grade retained after transfer"
);
check(
  data<any[]>(app.call("workforce.transfers.list", { status: "completed" }, manager)).some(
    (request) => request.id === transferId
  ),
  "source manager retains completed transfer record"
);
check(
  data<any[]>(app.call("message.list", {}, agentB)).some(
    (message) => message.kind === "employee_transfer"
  ),
  "handover employee receives completion message"
);
check(
  data<any[]>(app.call("message.list", {}, movedAgent)).some(
    (message) => message.kind === "employee_transfer"
  ),
  "moved employee receives transfer messages after relogin"
);
check(
  !app.call("workforce.transfers.execute", { id: transferId }, admin).ok,
  "completed transfer cannot execute twice"
);

const rejected = app.call(
  "workforce.transfers.create",
  {
    user_id: financeUser.id,
    to_store_id: storeB,
    handover_user_id: managerUser.id,
    to_role: "finance",
    effective_date: todayDate(),
    reason: "财务岗位调整",
  },
  admin
);
check(rejected.ok, "admin creates finance transfer");
check(
  !app.call(
    "workforce.transfers.review",
    { id: data<any>(rejected).id, status: "rejected", reason: "" },
    admin
  ).ok,
  "transfer rejection requires reason"
);
check(
  app.call(
    "workforce.transfers.review",
    { id: data<any>(rejected).id, status: "rejected", reason: "目标店暂缓接收" },
    admin
  ).ok,
  "admin rejects transfer with reason"
);
const cancellable = app.call(
  "workforce.transfers.create",
  {
    user_id: agentBUser.id,
    to_store_id: storeB,
    handover_user_id: managerUser.id,
    to_role: "agent",
    effective_date: todayDate(),
    reason: "测试取消调动",
  },
  manager
);
check(cancellable.ok, "manager creates cancellable transfer");
check(
  app.call(
    "workforce.transfers.cancel",
    { id: data<any>(cancellable).id },
    manager
  ).ok,
  "creator cancels pending transfer"
);

const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const future = app.call(
  "workforce.transfers.create",
  {
    user_id: agentCUser.id,
    to_store_id: storeA,
    handover_user_id: agentAUser.id,
    to_role: "agent",
    effective_date: tomorrow,
    reason: "未来日期调动",
  },
  admin
);
check(
  future.ok &&
    app.call(
      "workforce.transfers.review",
      { id: data<any>(future).id, status: "approved" },
      admin
    ).ok,
  "approve future-dated transfer"
);
check(
  !app.call("workforce.transfers.execute", { id: data<any>(future).id }, admin).ok,
  "future-dated transfer cannot execute early"
);

console.log(`Workforce smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
