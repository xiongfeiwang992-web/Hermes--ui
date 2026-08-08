import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const fixture = path.resolve("data", "deal-ext-evidence.txt");
fs.mkdirSync(path.dirname(fixture), { recursive: true });
fs.writeFileSync(fixture, "deal ext evidence", "utf8");
const app = createApp(seedDatabase(path.resolve("data", "deal-ext-smoke.db")).dbPath);
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
const finance = login("finance");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const house = app.call(
  "house.create",
  {
    title: "交易扩展测试房",
    deal_type: "sale",
    community: "扩展小区",
    price: 300,
    owner_name: "原业主张三",
    owner_phone: "13770000001",
    status: "available",
  },
  agent
);
check(house.ok, "create house for deal ext");
const customer = app.call(
  "customer.create",
  { name: "原客户李四", phone: "13870000001", intent: "buy" },
  agent
);
check(customer.ok, "create customer for deal ext");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 280,
    commission_owner: 8000,
    commission_customer: 8000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
check(deal.ok, "create deal for deal ext");
const dealId = data<any>(deal).id;
check(
  !app.call(
    "dealExt.complaints.create",
    {
      deal_id: dealId,
      category: "commission",
      title: "佣金争议",
      description: "对佣金分配有异议需要复核",
    },
    agent
  ).ok,
  "complaint rejected before deal approval"
);
check(app.call("deal.submit", { id: dealId }, agent).ok, "submit deal");
check(app.call("deal.approve", { id: dealId }, manager).ok, "approve deal");
check(
  !app.call(
    "dealExt.complaints.create",
    {
      deal_id: dealId,
      category: "commission",
      title: "佣",
      description: "短",
    },
    agent
  ).ok,
  "complaint validates title and description"
);
const complaint = app.call(
  "dealExt.complaints.create",
  {
    deal_id: dealId,
    category: "commission",
    title: "佣金争议",
    description: "对佣金分配有异议需要复核",
  },
  agent
);
check(complaint.ok, "agent creates deal complaint");
const complaintId = data<any>(complaint).id;
check(
  !app.call(
    "dealExt.complaints.create",
    {
      deal_id: dealId,
      category: "commission",
      title: "重复佣金争议",
      description: "再次登记同类投诉应被拦截",
    },
    agent
  ).ok,
  "duplicate open complaint category blocked"
);
const managerMessages = app.call("message.list", {}, manager);
check(
  managerMessages.ok &&
    data<any[]>(managerMessages).some((message) => message.kind === "deal_complaint"),
  "complaint notifies manager"
);
check(
  !app.call("dealExt.complaints.resolve", { id: complaintId, resolution: "已处理完成" }, manager)
    .ok,
  "cannot resolve before investigating"
);
check(
  app.call(
    "dealExt.complaints.investigate",
    { id: complaintId, assignee_user_id: agentId },
    manager
  ).ok,
  "manager starts complaint investigation"
);
check(
  !app.call(
    "dealExt.complaints.resolve",
    { id: complaintId, resolution: "已协商调整佣金" },
    agent
  ).ok,
  "resolve requires evidence attachment"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "deal_complaint",
      parent_id: complaintId,
      category: "complaint_evidence",
      name: "处理凭证.pdf",
      local_path: fixture,
    },
    agent
  ).ok,
  "upload complaint evidence"
);
check(
  app.call(
    "dealExt.complaints.resolve",
    { id: complaintId, resolution: "已协商调整佣金并确认" },
    agent
  ).ok,
  "resolve complaint after evidence"
);
const financeComplaints = app.call("dealExt.complaints.list", {}, finance);
check(
  financeComplaints.ok &&
    data<any[]>(financeComplaints).some((row) => row.id === complaintId),
  "finance can list deal complaints"
);
const peerComplaints = app.call("dealExt.complaints.list", {}, peer);
check(
  peerComplaints.ok &&
    !data<any[]>(peerComplaints).some((row) => row.id === complaintId),
  "peer agent cannot see unrelated complaint"
);

const withdrawDealHouse = app.call(
  "house.create",
  {
    title: "撤回投诉房",
    deal_type: "sale",
    community: "扩展小区",
    price: 200,
    owner_name: "业主王五",
    owner_phone: "13770000002",
    status: "available",
  },
  agent
);
check(withdrawDealHouse.ok, "create house for withdraw flow");
const withdrawCustomer = app.call(
  "customer.create",
  { name: "撤回客户", phone: "13870000002", intent: "buy" },
  agent
);
check(withdrawCustomer.ok, "create customer for withdraw flow");
const withdrawDeal = app.call(
  "deal.create",
  {
    house_id: data<any>(withdrawDealHouse).id,
    customer_id: data<any>(withdrawCustomer).id,
    contract_price: 190,
    commission_owner: 5000,
    commission_customer: 5000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
check(withdrawDeal.ok, "create deal for withdraw flow");
check(
  app.call("deal.submit", { id: data<any>(withdrawDeal).id }, agent).ok,
  "submit withdraw-flow deal"
);
check(
  app.call("deal.approve", { id: data<any>(withdrawDeal).id }, manager).ok,
  "approve withdraw-flow deal"
);
const openComplaint = app.call(
  "dealExt.complaints.create",
  {
    deal_id: data<any>(withdrawDeal).id,
    category: "service",
    title: "服务态度投诉",
    description: "带看与签约服务态度需改进",
  },
  agent
);
check(openComplaint.ok, "create complaint for withdraw");
check(
  app.call(
    "dealExt.complaints.withdraw",
    { id: data<any>(openComplaint).id, reason: "已当面沟通解决" },
    agent
  ).ok,
  "agent withdraws open complaint"
);

check(
  !app.call(
    "dealExt.renames.create",
    {
      deal_id: dealId,
      target: "customer",
      new_customer_name: "原客户李四",
      reason: "姓名未变",
    },
    agent
  ).ok,
  "rename rejects unchanged customer name"
);
const rename = app.call(
  "dealExt.renames.create",
  {
    deal_id: dealId,
    target: "both",
    new_customer_name: "新客户李四",
    new_owner_name: "新业主张三",
    reason: "网签主体名称更正",
  },
  agent
);
check(rename.ok, "create deal rename draft");
const renameId = data<any>(rename).id;
check(
  !app.call(
    "dealExt.renames.create",
    {
      deal_id: dealId,
      target: "customer",
      new_customer_name: "另一客户",
      reason: "重复申请",
    },
    agent
  ).ok,
  "pending rename blocks another request"
);
check(
  !app.call("dealExt.renames.submit", { id: renameId }, agent).ok,
  "rename submit requires evidence"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "deal_rename",
      parent_id: renameId,
      category: "rename_evidence",
      name: "更名证明.pdf",
      local_path: fixture,
    },
    agent
  ).ok,
  "upload rename evidence"
);
check(
  app.call("dealExt.renames.submit", { id: renameId }, agent).ok,
  "submit rename request"
);
const financeRenames = app.call("dealExt.renames.list", {}, finance);
check(
  financeRenames.ok && data<any[]>(financeRenames).length === 0,
  "finance cannot see rename requests"
);
check(
  app.call("dealExt.renames.approve", { id: renameId }, manager).ok,
  "manager approves rename"
);
const renamedCustomer = app.call("customer.list", {}, agent);
check(
  renamedCustomer.ok &&
    data<any[]>(renamedCustomer).some((row) => row.name === "新客户李四"),
  "approved rename updates customer name"
);
const renamedHouse = app.call("house.list", {}, agent);
check(
  renamedHouse.ok &&
    data<any[]>(renamedHouse).some((row) => row.owner_name === "新业主张三"),
  "approved rename updates owner name"
);

const rejectRenameDealHouse = app.call(
  "house.create",
  {
    title: "驳回更名房",
    deal_type: "sale",
    community: "扩展小区",
    price: 210,
    owner_name: "业主赵六",
    owner_phone: "13770000003",
    status: "available",
  },
  agent
);
check(rejectRenameDealHouse.ok, "create house for rename reject");
const rejectRenameCustomer = app.call(
  "customer.create",
  { name: "驳回更名客户", phone: "13870000003", intent: "buy" },
  agent
);
check(rejectRenameCustomer.ok, "create customer for rename reject");
const rejectRenameDeal = app.call(
  "deal.create",
  {
    house_id: data<any>(rejectRenameDealHouse).id,
    customer_id: data<any>(rejectRenameCustomer).id,
    contract_price: 200,
    commission_owner: 4000,
    commission_customer: 4000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
check(rejectRenameDeal.ok, "create deal for rename reject");
check(
  app.call("deal.submit", { id: data<any>(rejectRenameDeal).id }, agent).ok,
  "submit rename-reject deal"
);
check(
  app.call("deal.approve", { id: data<any>(rejectRenameDeal).id }, manager).ok,
  "approve rename-reject deal"
);
const rejectRename = app.call(
  "dealExt.renames.create",
  {
    deal_id: data<any>(rejectRenameDeal).id,
    target: "customer",
    new_customer_name: "不应生效客户",
    reason: "材料不齐先提交",
  },
  agent
);
check(rejectRename.ok, "create rename for reject flow");
check(
  app.call(
    "attachment.add",
    {
      parent_type: "deal_rename",
      parent_id: data<any>(rejectRename).id,
      category: "rename_evidence",
      name: "材料.pdf",
      local_path: fixture,
    },
    agent
  ).ok,
  "upload evidence for reject flow"
);
check(
  app.call("dealExt.renames.submit", { id: data<any>(rejectRename).id }, agent).ok,
  "submit rename for reject flow"
);
check(
  app.call(
    "dealExt.renames.reject",
    { id: data<any>(rejectRename).id, reason: "证明材料不完整" },
    manager
  ).ok,
  "manager rejects rename"
);
check(
  app.call(
    "dealExt.renames.cancel",
    { id: data<any>(rejectRename).id, reason: "暂不更名" },
    agent
  ).ok,
  "agent cancels rejected rename"
);
check(
  !app.call(
    "suite.create",
    {
      module: "deal_ext",
      record_type: "deal_complaint",
      title: "旧通用成交投诉",
    },
    manager
  ).ok,
  "generic suite deal_complaint removed"
);
check(
  !app.call(
    "suite.create",
    {
      module: "deal_ext",
      record_type: "rename",
      title: "旧通用成交更名",
    },
    manager
  ).ok,
  "generic suite rename removed"
);

console.log(`Deal ext smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
