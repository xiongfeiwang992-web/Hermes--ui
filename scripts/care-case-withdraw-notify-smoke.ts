import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "care-case-withdraw-notify-smoke.db")).dbPath
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
const withdrawMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "customer_care" &&
      (m.title === "客户投诉已撤回" || m.title === "诉讼案件已撤回")
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");

const customer = app.call(
  "customer.create",
  { name: "撤回通知客户", phone: "13881119901", intent: "buy" },
  agentA
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const complaint = app.call(
  "customerCare.cases.create",
  {
    customer_id: customerId,
    case_type: "complaint",
    title: "撤回通知服务投诉",
    description: "客户对服务有异议后确认误会",
    severity: "medium",
  },
  agentA
);
assert(complaint.ok && data<any>(complaint).status === "open", "create open complaint");
const complaintId = data<any>(complaint).id;

assert(
  !app.call(
    "customerCare.cases.withdraw",
    { id: complaintId, reason: "" },
    agentA
  ).ok,
  "withdraw requires reason"
);
assert(
  !app.call(
    "customerCare.cases.withdraw",
    { id: complaintId, reason: "他人不可撤回" },
    agentB
  ).ok,
  "peer cannot withdraw creator case"
);

const beforeManager = withdrawMsgs(manager).length;
const beforeAdmin = withdrawMsgs(admin).length;
const beforeAgent = withdrawMsgs(agentA).length;
const withdrawn = app.call(
  "customerCare.cases.withdraw",
  { id: complaintId, reason: "客户确认系误会" },
  agentA
);
assert(withdrawn.ok, "creator withdraws open complaint");
assert(data<any>(withdrawn).status === "withdrawn", "status withdrawn");

const afterManager = withdrawMsgs(manager);
assert(afterManager.length === beforeManager + 1, "manager receives withdraw message");
assert(afterManager[0].ref_id === complaintId, "message refs case");
assert(afterManager[0].title === "客户投诉已撤回", "complaint withdraw title");
assert(String(afterManager[0].body).includes("撤回通知服务投诉"), "body has title");
assert(String(afterManager[0].body).includes("客户确认系误会"), "body has reason");
assert(withdrawMsgs(admin).length === beforeAdmin + 1, "admin receives withdraw message");
assert(withdrawMsgs(agentA).length === beforeAgent, "withdrawer does not self-notify");
assert(
  !app.call(
    "customerCare.cases.withdraw",
    { id: complaintId, reason: "再次撤回" },
    agentA
  ).ok,
  "cannot withdraw twice"
);

const assignedCase = app.call(
  "customerCare.cases.create",
  {
    customer_id: customerId,
    case_type: "complaint",
    title: "已分派不可撤回",
    description: "分派后不应允许发起人撤回",
    severity: "low",
  },
  agentA
);
assert(assignedCase.ok, "create case for assign block");
const assignedId = data<any>(assignedCase).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
assert(
  app.call(
    "customerCare.cases.assign",
    { id: assignedId, assignee_user_id: agentBId, due_date: "2026-09-01" },
    manager
  ).ok,
  "manager assigns case"
);
assert(
  !app.call(
    "customerCare.cases.withdraw",
    { id: assignedId, reason: "分派后撤回" },
    agentA
  ).ok,
  "assigned case cannot withdraw"
);

const lawsuit = app.call(
  "customerCare.cases.create",
  {
    customer_id: customerId,
    case_type: "lawsuit",
    title: "撤回通知诉讼案",
    description: "诉讼登记后因和解撤回",
    severity: "high",
    legal_case_no: "（2026）测民初999号",
    court_name: "测试人民法院",
  },
  manager
);
assert(lawsuit.ok, "manager creates lawsuit");
const lawsuitId = data<any>(lawsuit).id;
const beforeAdminLawsuit = withdrawMsgs(admin).length;
const beforeManagerLawsuit = withdrawMsgs(manager).length;
assert(
  app.call(
    "customerCare.cases.withdraw",
    { id: lawsuitId, reason: "双方和解撤诉" },
    manager
  ).ok,
  "manager withdraws lawsuit"
);
const afterAdminLawsuit = withdrawMsgs(admin);
assert(
  afterAdminLawsuit.length === beforeAdminLawsuit + 1,
  "admin receives lawsuit withdraw"
);
assert(
  afterAdminLawsuit.some(
    (m) => m.ref_id === lawsuitId && m.title === "诉讼案件已撤回"
  ),
  "lawsuit withdraw title"
);
assert(
  withdrawMsgs(manager).length === beforeManagerLawsuit,
  "lawsuit withdrawer does not self-notify"
);

const muteCase = app.call(
  "customerCare.cases.create",
  {
    customer_id: customerId,
    case_type: "complaint",
    title: "静音撤回投诉",
    description: "用于静音客关频道测试",
    severity: "low",
  },
  agentA
);
assert(muteCase.ok, "create mute-test complaint");
assert(
  app.call("message.subscriptions.save", { channels: { care: false } }, manager).ok,
  "mute care channel"
);
const beforeMute = withdrawMsgs(manager).length;
assert(
  app.call(
    "customerCare.cases.withdraw",
    { id: data<any>(muteCase).id, reason: "静音场景撤回" },
    agentA
  ).ok,
  "withdraw while manager muted"
);
assert(withdrawMsgs(manager).length === beforeMute, "muted care suppresses withdraw message");

console.log(`Care case withdraw notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
