import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const fixture = path.resolve("data", "newhome-sales-contract.txt");
fs.mkdirSync(path.dirname(fixture), { recursive: true });
fs.writeFileSync(fixture, "newhome sales contract scan", "utf8");
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

check(
  app.call(
    "newhome.projects.save",
    {
      id: projectId,
      name: "未来新城",
      address: "未来大道 1 号",
      property_type: "residential",
      protection_days: 20,
      status: "active",
    },
    manager
  ).ok,
  "manager reactivates project for sales flow"
);
check(
  !app.call(
    "newhome.distribution.save",
    { name: "城南分销", contact_phone: "123" },
    manager
  ).ok,
  "distribution company rejects invalid phone"
);
check(
  !app.call(
    "newhome.distribution.save",
    { name: "城南分销", contact_phone: "13900002222" },
    agent
  ).ok,
  "agent cannot create distribution company"
);
const partner = app.call(
  "newhome.distribution.save",
  {
    name: "城南分销",
    contact_name: "李渠道",
    contact_phone: "13900002222",
    address: "城南大道 8 号",
  },
  manager
);
check(partner.ok, "manager creates distribution company");
const partnerId = data<any>(partner).id;
check(
  !app.call(
    "newhome.distribution.save",
    { name: "城南分销", contact_phone: "13900003333" },
    admin
  ).ok,
  "duplicate distribution company name blocked"
);
check(
  app.call(
    "newhome.distribution.status",
    { id: partnerId, status: "inactive" },
    manager
  ).ok,
  "manager disables distribution company"
);
check(
  app.call(
    "newhome.distribution.status",
    { id: partnerId, status: "active" },
    manager
  ).ok,
  "manager restores distribution company"
);
const exported = app.call("newhome.distribution.export", {}, manager);
check(
  exported.ok &&
    data<any>(exported).count >= 1 &&
    String(data<any>(exported).csv).includes("城南分销"),
  "export distribution companies csv"
);
const saleCustomer = app.call(
  "customer.create",
  { name: "销售报告客户", phone: "13830000003", intent: "buy" },
  agent
);
check(saleCustomer.ok, "create customer for sales report");
const saleRegistration = app.call(
  "newhome.registrations.create",
  {
    project_id: projectId,
    customer_id: data<any>(saleCustomer).id,
    source: "分销渠道",
  },
  agent
);
check(saleRegistration.ok, "register customer for sales report");
const saleRegistrationId = data<any>(saleRegistration).id;
check(
  !app.call(
    "newhome.sales.create",
    {
      registration_id: saleRegistrationId,
      unit_no: "1201",
      contract_price: 1800000,
      signed_at: "2026-08-01",
    },
    agent
  ).ok,
  "sales report requires arrived registration"
);
check(
  app.call(
    "newhome.registrations.arrival",
    { id: saleRegistrationId, arrival_note: "客户到场看房并认购" },
    agent
  ).ok,
  "confirm arrival before sales report"
);
check(
  !app.call(
    "newhome.sales.create",
    {
      registration_id: saleRegistrationId,
      unit_no: "1201",
      contract_price: 0,
      signed_at: "2026-08-01",
    },
    agent
  ).ok,
  "sales report rejects zero contract price"
);
const sale = app.call(
  "newhome.sales.create",
  {
    registration_id: saleRegistrationId,
    building: "A栋",
    unit_no: "1201",
    area_size: 98.5,
    contract_price: 1800000,
    signed_at: "2026-08-01",
    distribution_company_id: partnerId,
  },
  agent
);
check(sale.ok, "agent creates sales report draft");
const saleId = data<any>(sale).id;
check(
  !app.call(
    "newhome.sales.create",
    {
      registration_id: saleRegistrationId,
      unit_no: "1202",
      contract_price: 1900000,
      signed_at: "2026-08-02",
    },
    agent
  ).ok,
  "one active sales report per registration"
);
check(
  !app.call("newhome.sales.submit", { id: saleId }, agent).ok,
  "submit requires contract scan attachment"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "newhome_sales_report",
      parent_id: saleId,
      category: "contract_scan",
      name: "网签合同.pdf",
      local_path: fixture,
    },
    agent
  ).ok,
  "upload sales report contract scan"
);
check(
  app.call("newhome.sales.submit", { id: saleId }, agent).ok,
  "submit sales report after material upload"
);
const managerMessages = app.call("message.list", {}, manager);
check(
  managerMessages.ok &&
    data<any[]>(managerMessages).some(
      (message) => message.kind === "newhome_sales_report"
    ),
  "submit notifies store manager"
);
check(
  !app.call("newhome.sales.settle", { id: saleId, settlement_amount: 10000, settlement_note: "已结" }, finance).ok,
  "cannot settle before approval"
);
check(
  app.call("newhome.sales.approve", { id: saleId }, manager).ok,
  "manager approves sales report"
);
const soldRows = app.call(
  "newhome.registrations.list",
  { status: "sold" },
  manager
);
check(
  soldRows.ok &&
    data<any[]>(soldRows).some((row) => row.id === saleRegistrationId),
  "approved sales report marks registration sold"
);
check(
  !app.call(
    "newhome.registrations.invalidate",
    { id: saleRegistrationId, reason: "尝试作废已成交" },
    manager
  ).ok,
  "sold registration with sales report cannot invalidate"
);
const agentSaleList = app.call("newhome.sales.list", {}, agent);
check(
  agentSaleList.ok &&
    data<any[]>(agentSaleList).some(
      (row) => row.id === saleId && row.settlement_amount == null
    ),
  "agent cannot see settlement amount before settle visibility"
);
check(
  !app.call(
    "newhome.sales.settle",
    { id: saleId, settlement_amount: -1, settlement_note: "无效" },
    finance
  ).ok,
  "settle rejects negative amount"
);
check(
  app.call(
    "newhome.sales.settle",
    {
      id: saleId,
      settlement_amount: 36000,
      settlement_note: "渠道结佣完成",
    },
    finance
  ).ok,
  "finance settles approved sales report"
);
const financeSales = app.call("newhome.sales.list", { status: "settled" }, finance);
check(
  financeSales.ok &&
    data<any[]>(financeSales).some(
      (row) => row.id === saleId && row.settlement_amount === 36000
    ),
  "finance sees settlement amount"
);
const agentAfterSettle = app.call("newhome.sales.list", { status: "settled" }, agent);
check(
  agentAfterSettle.ok &&
    data<any[]>(agentAfterSettle).some(
      (row) => row.id === saleId && row.settlement_amount == null
    ),
  "agent settlement details remain hidden"
);
const peerSales = app.call("newhome.sales.list", {}, peer);
check(
  peerSales.ok && !data<any[]>(peerSales).some((row) => row.id === saleId),
  "peer agent cannot see another agent sales report"
);
const rejectedCustomer = app.call(
  "customer.create",
  { name: "驳回客户", phone: "13830000004", intent: "buy" },
  agent
);
check(rejectedCustomer.ok, "create customer for reject flow");
const rejectRegistration = app.call(
  "newhome.registrations.create",
  {
    project_id: projectId,
    customer_id: data<any>(rejectedCustomer).id,
  },
  agent
);
check(rejectRegistration.ok, "register customer for reject flow");
check(
  app.call(
    "newhome.registrations.arrival",
    {
      id: data<any>(rejectRegistration).id,
      arrival_note: "到场后资料不齐",
    },
    agent
  ).ok,
  "arrival for reject flow"
);
const rejectSale = app.call(
  "newhome.sales.create",
  {
    registration_id: data<any>(rejectRegistration).id,
    unit_no: "801",
    contract_price: 1200000,
    signed_at: "2026-08-03",
  },
  agent
);
check(rejectSale.ok, "create sales report for reject flow");
check(
  app.call(
    "attachment.add",
    {
      parent_type: "newhome_sales_report",
      parent_id: data<any>(rejectSale).id,
      category: "contract_scan",
      name: "合同.pdf",
      local_path: fixture,
    },
    agent
  ).ok,
  "upload contract for reject flow"
);
check(
  app.call("newhome.sales.submit", { id: data<any>(rejectSale).id }, agent).ok,
  "submit sales report for reject flow"
);
check(
  app.call(
    "newhome.sales.reject",
    { id: data<any>(rejectSale).id, reason: "网签资料不完整" },
    manager
  ).ok,
  "manager rejects sales report"
);
check(
  app.call(
    "newhome.sales.cancel",
    { id: data<any>(rejectSale).id, reason: "客户退房不再申报" },
    agent
  ).ok,
  "agent cancels rejected sales report"
);
check(
  !app.call(
    "suite.create",
    {
      module: "newhome",
      record_type: "sales_report",
      title: "旧通用销售报告",
    },
    manager
  ).ok,
  "generic suite newhome sales_report removed"
);
check(
  !app.call(
    "suite.create",
    {
      module: "newhome",
      record_type: "distribution_company",
      title: "旧通用分销公司",
    },
    manager
  ).ok,
  "generic suite distribution_company removed"
);

console.log(`Newhome smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
