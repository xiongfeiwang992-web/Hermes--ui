import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "office-collab-smoke.db")).dbPath);
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
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

check(!app.call("officeCollab.exams.list", {}, finance).ok, "finance cannot access exams");
const exam = app.call(
  "officeCollab.exams.save",
  { title: "合规考试", pass_score: 60, duration_minutes: 30 },
  manager
);
check(exam.ok, "manager creates exam");
const examId = data<any>(exam).id;
check(
  !app.call("officeCollab.exams.attempt", { exam_id: examId, score: 80 }, agent).ok,
  "cannot attempt unpublished exam"
);
check(app.call("officeCollab.exams.publish", { id: examId }, manager).ok, "publish exam");
const attempt = app.call(
  "officeCollab.exams.attempt",
  { exam_id: examId, score: 85 },
  agent
);
check(attempt.ok && data<any>(attempt).passed === true, "agent submits passing score");
check(
  !app.call("officeCollab.exams.attempt", { exam_id: examId, score: 90 }, agent).ok,
  "duplicate exam attempt blocked"
);

const event = app.call(
  "officeCollab.events.save",
  {
    title: "门店周会",
    start_at: "2026-08-10T10:00:00.000Z",
    end_at: "2026-08-10T11:00:00.000Z",
    location: "一楼会议室",
    capacity: 1,
  },
  manager
);
check(event.ok, "manager creates event");
const eventId = data<any>(event).id;
check(
  !app.call("officeCollab.events.signup", { id: eventId }, agent).ok,
  "cannot signup draft event"
);
check(app.call("officeCollab.events.open", { id: eventId }, manager).ok, "open event");
check(app.call("officeCollab.events.signup", { id: eventId }, agent).ok, "agent signs up");
check(
  !app.call("officeCollab.events.signup", { id: eventId }, peer).ok,
  "event capacity enforced"
);

const workflow = app.call(
  "officeCollab.workflows.create",
  {
    title: "费用特批会签",
    content: "申请特批营销费用",
    approver_user_ids: [peerId],
  },
  agent
);
check(workflow.ok, "agent creates workflow");
const workflowId = data<any>(workflow).id;
check(
  app.call("officeCollab.workflows.submit", { id: workflowId }, agent).ok,
  "submit workflow"
);
const peerMessages = app.call("message.list", {}, peer);
check(
  peerMessages.ok &&
    data<any[]>(peerMessages).some((message) => message.kind === "office_workflow"),
  "workflow notifies approver"
);
check(
  !app.call(
    "officeCollab.workflows.decide",
    { id: workflowId, decision: "approved" },
    agent
  ).ok,
  "non-approver cannot decide"
);
check(
  app.call(
    "officeCollab.workflows.decide",
    { id: workflowId, decision: "approved" },
    peer
  ).ok,
  "approver approves workflow"
);
const workflows = app.call("officeCollab.workflows.list", {}, agent);
check(
  workflows.ok &&
    data<any[]>(workflows).some(
      (row) => row.id === workflowId && row.status === "approved"
    ),
  "workflow becomes approved"
);

const ticket = app.call(
  "officeCollab.tickets.create",
  { ticket_type: "receipt", title: "收据本申领", quantity: 2 },
  agent
);
check(ticket.ok, "agent requests ticket");
const ticketId = data<any>(ticket).id;
check(
  !app.call("officeCollab.tickets.approve", { id: ticketId }, agent).ok,
  "applicant cannot approve own ticket"
);
check(
  app.call("officeCollab.tickets.approve", { id: ticketId }, manager).ok,
  "manager approves ticket"
);
check(
  app.call("officeCollab.tickets.issue", { id: ticketId }, manager).ok,
  "manager issues ticket"
);
check(
  app.call("officeCollab.tickets.return", { id: ticketId }, agent).ok,
  "agent returns ticket"
);

const summary = app.call(
  "officeCollab.summaries.save",
  {
    period_start: "2026-08-01",
    period_end: "2026-08-07",
    content: "本周完成两单带看并跟进重点客",
  },
  agent
);
check(summary.ok, "agent writes summary");
const summaryId = data<any>(summary).id;
check(
  app.call("officeCollab.summaries.submit", { id: summaryId }, agent).ok,
  "submit summary"
);
check(
  app.call(
    "officeCollab.summaries.review",
    { id: summaryId, comment: "总结清楚，继续保持" },
    manager
  ).ok,
  "manager reviews summary"
);

const post = app.call(
  "officeCollab.circle.create",
  { content: "欢迎新同事加入门店" },
  agent
);
check(post.ok, "create circle post");
check(
  app.call(
    "officeCollab.circle.hide",
    { id: data<any>(post).id, reason: "内容需调整" },
    manager
  ).ok,
  "manager hides circle post"
);

const house = app.call(
  "house.create",
  {
    title: "来电匹配房",
    deal_type: "sale",
    community: "协同小区",
    price: 100,
    owner_name: "来电业主",
    owner_phone: "13790000001",
    status: "available",
  },
  agent
);
check(house.ok, "create house for call match");
const customer = app.call(
  "customer.create",
  { name: "来电客户", phone: "13890000001", intent: "buy" },
  agent
);
check(customer.ok, "create customer for call match");
const callCustomer = app.call(
  "officeCollab.calls.create",
  {
    phone: "13890000001",
    direction: "in",
    note: "咨询学区",
    called_at: "2026-08-08T09:00:00.000Z",
  },
  agent
);
check(
  callCustomer.ok &&
    data<any>(callCustomer).matched_customer_id === data<any>(customer).id,
  "call matches customer phone"
);
const callHouse = app.call(
  "officeCollab.calls.create",
  {
    phone: "13790000001",
    direction: "out",
    note: "回访业主",
    called_at: "2026-08-08T10:00:00.000Z",
  },
  agent
);
check(
  callHouse.ok && data<any>(callHouse).matched_house_id === data<any>(house).id,
  "call matches house owner phone"
);

check(
  !app.call(
    "suite.create",
    { module: "office", record_type: "exam", title: "旧考试" },
    manager
  ).ok,
  "generic suite exam removed"
);
check(
  !app.call(
    "suite.create",
    { module: "office", record_type: "call_record", title: "旧来电" },
    manager
  ).ok,
  "generic suite call_record removed"
);
const modules = app.call("suite.modules", {}, admin);
check(
  modules.ok && data<any[]>(modules).length === 0,
  "no generic suite modules remain"
);

console.log(`Office collab smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
