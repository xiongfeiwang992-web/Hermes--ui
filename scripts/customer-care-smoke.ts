import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "customer-care-smoke.db"));
const app = createApp(seeded.dbPath);
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
const agentAUser = data<any>(app.call("auth.me", {}, agentA));
const agentBUser = data<any>(app.call("auth.me", {}, agentB));

const customer = app.call(
  "customer.create",
  {
    name: "客户关怀测试客户",
    phone: "13881112222",
    intent: "rent",
    visibility: "private",
  },
  agentA
);
check(customer.ok, "create customer for customer-care workflow");
const customerId = data<any>(customer).id;
check(
  data<any>(app.call("customerCare.options", {}, finance)).customers.length === 0,
  "finance receives no customer-care options"
);
check(
  data<any>(app.call("customerCare.options", {}, agentA)).customers.some(
    (item: any) => item.id === customerId
  ),
  "customer owner receives visible customer option"
);
check(
  !data<any>(app.call("customerCare.options", {}, agentB)).customers.some(
    (item: any) => item.id === customerId
  ),
  "private customer excluded from unrelated agent options"
);
check(
  !app.call(
    "customerCare.cases.create",
    {
      customer_id: customerId,
      case_type: "complaint",
      title: "财务投诉",
      description: "无权",
      severity: "medium",
    },
    finance
  ).ok,
  "finance cannot create customer-care case"
);
check(
  !app.call(
    "customerCare.cases.create",
    {
      customer_id: customerId,
      case_type: "unknown",
      title: "无效类型",
      description: "无效",
      severity: "medium",
    },
    agentA
  ).ok,
  "customer-care case type validated"
);
check(
  !app.call(
    "customerCare.cases.create",
    {
      customer_id: customerId,
      case_type: "complaint",
      title: "无效严重度",
      description: "无效",
      severity: "urgent",
    },
    agentA
  ).ok,
  "customer-care severity validated"
);
check(
  !app.call(
    "customerCare.cases.create",
    {
      customer_id: customerId,
      case_type: "lawsuit",
      title: "越权诉讼",
      description: "无权",
      severity: "high",
      legal_case_no: "A-001",
      court_name: "测试法院",
    },
    agentA
  ).ok,
  "agent cannot create lawsuit case"
);
const complaint = app.call(
  "customerCare.cases.create",
  {
    customer_id: customerId,
    case_type: "complaint",
    title: "服务承诺未按时完成",
    description: "客户反映看房后资料回复延迟。",
    severity: "high",
  },
  agentA
);
check(
  complaint.ok && data<any>(complaint).status === "open",
  "agent creates complaint for own customer"
);
const complaintId = data<any>(complaint).id;
check(
  data<any[]>(app.call("customerCare.cases.list", {}, agentA)).some(
    (item) => item.id === complaintId && item.customer_phone === "13881112222"
  ),
  "complaint creator sees own case and customer phone"
);
check(
  data<any[]>(app.call("customerCare.cases.list", {}, agentB)).length === 0,
  "unrelated agent cannot see complaint"
);
check(
  data<any[]>(app.call("customerCare.cases.list", {}, manager)).some(
    (item) => item.id === complaintId
  ),
  "store manager sees store complaint"
);
check(
  data<any[]>(app.call("message.list", {}, manager)).some(
    (message) => message.ref_id === complaintId && message.kind === "customer_care"
  ),
  "manager receives new complaint message"
);
check(
  !app.call(
    "customerCare.cases.assign",
    {
      id: complaintId,
      assignee_user_id: agentBUser.id,
      due_date: "",
    },
    manager
  ).ok,
  "case assignment requires valid due date"
);
check(
  !app.call(
    "customerCare.cases.assign",
    {
      id: complaintId,
      assignee_user_id: agentBUser.id,
      due_date: "2026-08-15",
    },
    agentA
  ).ok,
  "agent cannot assign complaint"
);
check(
  app.call(
    "customerCare.cases.assign",
    {
      id: complaintId,
      assignee_user_id: agentBUser.id,
      due_date: "2026-08-15",
    },
    manager
  ).ok,
  "manager assigns complaint to same-store employee"
);
const assignedView = data<any[]>(
  app.call("customerCare.cases.list", {}, agentB)
).find((item) => item.id === complaintId);
check(
  assignedView?.customer_phone === "138****2222",
  "assigned non-owner sees masked customer phone"
);
check(
  data<any[]>(app.call("message.list", {}, agentB)).some(
    (message) => message.ref_id === complaintId
  ),
  "assignee receives case assignment message"
);
check(
  !app.call("customerCare.cases.investigate", { id: complaintId }, agentA).ok,
  "unassigned creator cannot investigate assigned complaint"
);
check(
  app.call("customerCare.cases.investigate", { id: complaintId }, agentB).ok,
  "assignee starts complaint investigation"
);
check(
  !app.call(
    "customerCare.cases.resolve",
    { id: complaintId, resolution: "已补发资料并致歉" },
    agentB
  ).ok,
  "complaint resolution requires evidence attachment"
);
const fixture = path.resolve("data", "customer-care-fixture.txt");
fs.writeFileSync(fixture, "customer care evidence", "utf8");
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "customer_care_case",
      parent_id: complaintId,
      category: "legal_document",
      name: "错误文书.txt",
      local_path: fixture,
    },
    agentB
  ).ok,
  "complaint attachment category validated"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "customer_care_case",
      parent_id: complaintId,
      category: "complaint_evidence",
      name: "处理凭证.txt",
      local_path: fixture,
    },
    agentB
  ).ok,
  "complaint assignee uploads handling evidence"
);
check(
  app.call(
    "customerCare.cases.resolve",
    { id: complaintId, resolution: "已补发资料并向客户致歉" },
    agentB
  ).ok,
  "assignee resolves evidenced complaint"
);
check(
  !app.call("customerCare.cases.close", { id: complaintId }, agentB).ok,
  "assignee cannot close resolved complaint"
);
check(
  app.call("customerCare.cases.close", { id: complaintId }, manager).ok,
  "manager closes resolved complaint"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "customer_care_case",
      parent_id: complaintId,
      category: "resolution_evidence",
      name: "结案后附件.txt",
      local_path: fixture,
    },
    manager
  ).ok,
  "closed case rejects additional attachments"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.ref_id === complaintId
  ),
  "complaint creator receives closure message"
);

const withdrawal = app.call(
  "customerCare.cases.create",
  {
    customer_id: customerId,
    case_type: "complaint",
    title: "误报投诉",
    description: "待撤回。",
    severity: "low",
  },
  agentA
);
const withdrawalId = data<any>(withdrawal).id;
check(withdrawal.ok, "create complaint for withdrawal");
check(
  !app.call(
    "customerCare.cases.withdraw",
    { id: withdrawalId, reason: "" },
    agentA
  ).ok,
  "complaint withdrawal requires reason"
);
check(
  app.call(
    "customerCare.cases.withdraw",
    { id: withdrawalId, reason: "客户确认系误会" },
    agentA
  ).ok,
  "creator withdraws unassigned complaint"
);

check(
  !app.call(
    "customerCare.cases.create",
    {
      customer_id: customerId,
      case_type: "lawsuit",
      title: "合同争议诉讼",
      description: "合同履行争议。",
      severity: "critical",
      legal_case_no: "",
      court_name: "",
    },
    manager
  ).ok,
  "lawsuit requires case number and court"
);
const lawsuit = app.call(
  "customerCare.cases.create",
  {
    customer_id: customerId,
    case_type: "lawsuit",
    title: "合同争议诉讼",
    description: "合同履行争议。",
    severity: "critical",
    legal_case_no: "（2026）测民初001号",
    court_name: "测试区人民法院",
  },
  manager
);
check(lawsuit.ok, "manager registers lawsuit with legal details");
const lawsuitId = data<any>(lawsuit).id;
check(
  app.call(
    "customerCare.cases.assign",
    {
      id: lawsuitId,
      assignee_user_id: agentBUser.id,
      due_date: "2026-09-01",
    },
    manager
  ).ok,
  "manager assigns lawsuit"
);
check(
  app.call("customerCare.cases.investigate", { id: lawsuitId }, agentB).ok,
  "assignee starts lawsuit handling"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "customer_care_case",
      parent_id: lawsuitId,
      category: "legal_document",
      name: "诉讼文书.txt",
      local_path: fixture,
    },
    manager
  ).ok,
  "manager uploads lawsuit document"
);
check(
  app.call(
    "customerCare.cases.resolve",
    { id: lawsuitId, resolution: "法院调解结案" },
    manager
  ).ok,
  "manager resolves lawsuit with legal document"
);

check(
  !app.call(
    "customerCare.tasks.create",
    {
      customer_id: customerId,
      task_type: "survey",
      purpose: "越权满意度调查",
      assignee_user_id: agentAUser.id,
      due_at: "2026-08-09T10:00",
    },
    agentA
  ).ok,
  "agent cannot create satisfaction survey"
);
const callback = app.call(
  "customerCare.tasks.create",
  {
    customer_id: customerId,
    task_type: "callback",
    purpose: "投诉结案后回访",
    assignee_user_id: agentBUser.id,
    case_id: complaintId,
    due_at: "2026-01-01T10:00",
  },
  agentA
);
check(callback.ok, "agent creates callback for own customer");
const callbackId = data<any>(callback).id;
const callbackRow = data<any[]>(
  app.call("customerCare.tasks.list", {}, agentA)
).find((item) => item.id === callbackId);
check(
  callbackRow?.assignee_user_id === agentAUser.id && callbackRow.status === "overdue",
  "agent callback is assigned to self and refreshes overdue"
);
check(
  !app.call(
    "customerCare.tasks.create",
    {
      customer_id: customerId,
      task_type: "callback",
      purpose: "重复回访",
      due_at: "2026-08-10T10:00",
    },
    agentA
  ).ok,
  "duplicate open callback prevented"
);
check(
  !app.call(
    "customerCare.tasks.complete",
    { id: callbackId, result: "" },
    agentA
  ).ok,
  "callback completion requires result"
);
check(
  app.call(
    "customerCare.tasks.complete",
    {
      id: callbackId,
      result: "客户确认问题已解决",
      satisfaction_score: 4,
    },
    agentA
  ).ok,
  "assignee completes overdue callback with optional score"
);
check(
  !app.call(
    "customerCare.tasks.complete",
    {
      id: callbackId,
      result: "重复完成",
      satisfaction_score: 4,
    },
    agentA
  ).ok,
  "completed callback is immutable"
);

const survey = app.call(
  "customerCare.tasks.create",
  {
    customer_id: customerId,
    task_type: "survey",
    purpose: "租赁服务满意度调查",
    assignee_user_id: agentBUser.id,
    due_at: "2026-08-20T10:00",
  },
  manager
);
check(survey.ok, "manager creates satisfaction survey");
const surveyId = data<any>(survey).id;
check(
  data<any[]>(app.call("customerCare.tasks.list", {}, agentB)).some(
    (item) => item.id === surveyId
  ),
  "survey assignee sees assigned survey"
);
check(
  data<any[]>(app.call("message.list", {}, agentB)).some(
    (message) => message.ref_id === surveyId
  ),
  "survey assignee receives assignment message"
);
check(
  !app.call(
    "customerCare.tasks.complete",
    {
      id: surveyId,
      result: "客户反馈良好",
      satisfaction_score: 6,
    },
    agentB
  ).ok,
  "survey score restricted to one through five"
);
check(
  app.call(
    "customerCare.tasks.complete",
    {
      id: surveyId,
      result: "客户反馈良好",
      satisfaction_score: 5,
    },
    agentB
  ).ok,
  "assignee completes satisfaction survey"
);

const cancelledTask = app.call(
  "customerCare.tasks.create",
  {
    customer_id: customerId,
    task_type: "callback",
    purpose: "例行客户回访",
    assignee_user_id: agentBUser.id,
    due_at: "2026-08-30T10:00",
  },
  manager
);
const cancelledTaskId = data<any>(cancelledTask).id;
check(cancelledTask.ok, "manager creates callback for cancellation");
check(
  !app.call(
    "customerCare.tasks.cancel",
    { id: cancelledTaskId, reason: "" },
    manager
  ).ok,
  "task cancellation requires reason"
);
check(
  !app.call(
    "customerCare.tasks.cancel",
    { id: cancelledTaskId, reason: "越权取消" },
    agentB
  ).ok,
  "assignee cannot cancel manager-created task"
);
check(
  app.call(
    "customerCare.tasks.cancel",
    { id: cancelledTaskId, reason: "客户要求改期，取消后重建" },
    manager
  ).ok,
  "manager cancels pending callback"
);
const caseEvents = app.call(
  "customerCare.events",
  { entity_type: "case", entity_id: complaintId },
  agentA
);
check(
  caseEvents.ok &&
    data<any[]>(caseEvents).some((event) => event.event_type === "assigned") &&
    data<any[]>(caseEvents).some((event) => event.event_type === "closed"),
  "case event history includes assignment and closure"
);
check(
  !app.call(
    "customerCare.events",
    { entity_type: "case", entity_id: complaintId },
    agentC
  ).ok,
  "other-store agent cannot inspect case events"
);
check(
  data<any[]>(app.call("customerCare.cases.list", {}, finance)).length === 0 &&
    data<any[]>(app.call("customerCare.tasks.list", {}, finance)).length === 0,
  "finance cannot read customer-care cases or tasks"
);
for (const type of ["complaint", "lawsuit", "survey", "callback"]) {
  check(
    !app.call(
      "suite.create",
      {
        module: "customer_care",
        record_type: type,
        title: `通用${type}`,
        data: {},
      },
      manager
    ).ok,
    `generic customer-care type ${type} disabled`
  );
}
const audits = data<any[]>(
  app.call("audit.list", { entity_type: "customer_care_case" }, admin)
);
check(
  audits.some((item) => item.action === "customer_care.case.assign") &&
    audits.some((item) => item.action === "customer_care.case.close"),
  "customer-care case lifecycle writes audit logs"
);

console.log(`Customer care smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
