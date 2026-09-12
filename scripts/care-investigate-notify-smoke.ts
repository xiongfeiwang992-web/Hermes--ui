import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "care-investigate-notify-smoke.db")).dbPath
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
const investigateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "customer_care" &&
      (m.title === "客户投诉已开始调查" || m.title === "诉讼案件已开始调查")
  );

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

function prepareAssigned(title: string, phone: string) {
  const customer = app.call(
    "customer.create",
    { name: `调查客${phone.slice(-4)}`, phone, intent: "buy" },
    agentA
  );
  assert(customer.ok, `create customer ${phone}`);
  const created = app.call(
    "customerCare.cases.create",
    {
      case_type: "complaint",
      customer_id: data<any>(customer).id,
      title,
      description: "客户反馈服务问题需要调查",
      severity: "medium",
    },
    agentA
  );
  assert(created.ok, `create case ${title}`);
  const id = data<any>(created).id;
  assert(
    app.call(
      "customerCare.cases.assign",
      { id, assignee_user_id: agentBId, due_date: "2026-09-30" },
      manager
    ).ok,
    `assign ${title}`
  );
  return id;
}

const caseId = prepareAssigned("调查通知投诉", "13824001001");
assert(
  !app.call("customerCare.cases.investigate", { id: caseId }, agentA).ok,
  "creator without assign cannot investigate"
);

const beforeA = investigateMsgs(agentA).length;
const beforeB = investigateMsgs(agentB).length;
const beforeM = investigateMsgs(manager).length;
const investigated = app.call("customerCare.cases.investigate", { id: caseId }, agentB);
assert(investigated.ok, "assignee starts investigation");
assert(data<any>(investigated).status === "investigating", "status investigating");
assert(investigateMsgs(agentA).length === beforeA + 1, "creator receives investigate message");
assert(investigateMsgs(agentB).length === beforeB, "assignee actor skips self");
assert(investigateMsgs(manager).length === beforeM, "manager not in recipient set");
assert(
  investigateMsgs(agentA).some(
    (m) =>
      m.ref_id === caseId &&
      m.ref_type === "customer_care_case" &&
      m.title === "客户投诉已开始调查" &&
      String(m.body).includes("调查通知投诉")
  ),
  "investigate message body"
);
assert(
  !app.call("customerCare.cases.investigate", { id: caseId }, agentB).ok,
  "cannot investigate twice"
);

const mgrCase = prepareAssigned("店长启动调查投诉", "13824001002");
const beforeCreator = investigateMsgs(agentA).length;
const beforeAssignee = investigateMsgs(agentB).length;
const beforeMgr = investigateMsgs(manager).length;
assert(
  app.call("customerCare.cases.investigate", { id: mgrCase }, manager).ok,
  "manager starts investigation"
);
assert(investigateMsgs(manager).length === beforeMgr, "manager actor skips self");
assert(investigateMsgs(agentA).length === beforeCreator + 1, "creator notified on manager investigate");
assert(investigateMsgs(agentB).length === beforeAssignee + 1, "assignee notified on manager investigate");

const mutedCase = prepareAssigned("静音调查投诉", "13824001003");
assert(
  app.call("message.subscriptions.save", { channels: { care: false } }, agentA).ok,
  "mute care"
);
const beforeMute = investigateMsgs(agentA).length;
assert(
  app.call("customerCare.cases.investigate", { id: mutedCase }, agentB).ok,
  "investigate while muted"
);
assert(investigateMsgs(agentA).length === beforeMute, "muted care suppresses investigate message");

console.log(`Care investigate notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
