import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "newhome-smoke.db")).dbPath);
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
const agent = login("agent_a");
const peer = login("agent_b");
const crossStore = login("agent_c");
const finance = login("finance");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

check(
  !app.call(
    "newhome.projects.save",
    {
      name: "无效保护期项目",
      address: "测试地址",
      property_type: "residential",
      protection_days: 0,
    },
    manager
  ).ok,
  "reject invalid project protection days"
);
const project = app.call(
  "newhome.projects.save",
  {
    name: "未来新城",
    address: "未来大道 1 号",
    property_type: "residential",
    protection_days: 20,
    contact_name: "项目张经理",
    contact_phone: "13900001111",
    commission_rule: "到款后结佣",
  },
  manager
);
check(project.ok, "create local newhome project");
const projectId = data<any>(project).id;
check(
  !app.call(
    "newhome.projects.save",
    {
      name: "未来新城",
      address: "重复地址",
      property_type: "residential",
      protection_days: 20,
    },
    admin
  ).ok,
  "prevent duplicate project name"
);
const projects = app.call("newhome.projects.list", { status: "active" }, agent);
check(
  projects.ok && data<any[]>(projects).some((item) => item.id === projectId),
  "agent lists active newhome projects"
);
const customer = app.call(
  "customer.create",
  { name: "新房客户", phone: "13830000001", intent: "buy" },
  agent
);
check(customer.ok, "create customer for registration");
const customerId = data<any>(customer).id;
const registration = app.call(
  "newhome.registrations.create",
  {
    project_id: projectId,
    customer_id: customerId,
    source: "门店到访",
  },
  agent
);
check(registration.ok, "register customer to newhome project");
const registrationId = data<any>(registration).id;
check(
  new Date(data<any>(registration).protect_until).getTime() > Date.now(),
  "registration computes future protection deadline"
);
check(
  !app.call(
    "newhome.registrations.create",
    {
      project_id: projectId,
      customer_id: customerId,
      agent_id: agentId,
    },
    manager
  ).ok,
  "duplicate registration blocked during protection"
);
const peerRows = app.call("newhome.registrations.list", {}, peer);
check(
  peerRows.ok &&
    !data<any[]>(peerRows).some((item) => item.id === registrationId),
  "peer agent cannot see another agent registration"
);
check(
  !app.call(
    "newhome.registrations.arrival",
    { id: registrationId, arrival_note: "到" },
    agent
  ).ok,
  "arrival requires meaningful note"
);
check(
  app.call(
    "newhome.registrations.arrival",
    { id: registrationId, arrival_note: "客户已到项目售楼处" },
    agent
  ).ok,
  "confirm customer arrival"
);
check(
  !app.call(
    "newhome.registrations.invalidate",
    { id: registrationId, reason: "" },
    manager
  ).ok,
  "registration invalidation requires reason"
);
check(
  app.call(
    "newhome.registrations.invalidate",
    { id: registrationId, reason: "客户主动取消看房" },
    manager
  ).ok,
  "manager invalidates registration"
);
const messages = app.call("message.list", {}, agent);
check(
  messages.ok &&
    data<any[]>(messages).some((message) => message.kind === "newhome_registration"),
  "invalidation notifies registration agent"
);
const second = app.call(
  "newhome.registrations.create",
  { project_id: projectId, customer_id: customerId },
  agent
);
check(second.ok, "allow re-registration after invalidation");
app.db
  .prepare(`UPDATE newhome_registrations SET protect_until=? WHERE id=?`)
  .run(new Date(Date.now() - 86400000).toISOString(), data<any>(second).id);
const expired = app.call("newhome.registrations.expire", {}, manager);
check(expired.ok && data<any>(expired).expired === 1, "expire overdue registration");
check(
  app.call(
    "newhome.registrations.create",
    { project_id: projectId, customer_id: customerId },
    agent
  ).ok,
  "allow re-registration after protection expiry"
);
check(
  !app.call(
    "newhome.registrations.create",
    { project_id: projectId, customer_id: customerId },
    crossStore
  ).ok,
  "cross-store agent cannot register inaccessible customer"
);
check(
  !app.call("newhome.registrations.list", {}, finance).ok,
  "finance cannot access customer registrations"
);
check(
  app.call(
    "newhome.projects.save",
    {
      id: projectId,
      name: "未来新城",
      address: "未来大道 1 号",
      property_type: "residential",
      protection_days: 20,
      status: "inactive",
    },
    manager
  ).ok,
  "manager disables own project"
);
const anotherCustomer = app.call(
  "customer.create",
  { name: "停用项目客户", phone: "13830000002", intent: "buy" },
  agent
);
check(anotherCustomer.ok, "create second newhome customer");
check(
  !app.call(
    "newhome.registrations.create",
    { project_id: projectId, customer_id: data<any>(anotherCustomer).id },
    agent
  ).ok,
  "disabled project rejects registration"
);

console.log(`Newhome smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
