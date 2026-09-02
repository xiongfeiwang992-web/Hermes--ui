import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "workflow-decide-notify-smoke.db")).dbPath
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
const stepMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_workflow" && m.title === "会签已通过一步"
  );
const doneMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_workflow" && m.title === "会签已全部通过"
  );
const rejectMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_workflow" && m.title === "会签已驳回"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const managerId = data<any>(app.call("auth.me", {}, manager)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

function createSubmitted(title: string, approverIds: string[]) {
  const created = app.call(
    "officeCollab.workflows.create",
    {
      title,
      content: `${title}正文内容`,
      approver_user_ids: approverIds,
    },
    agent
  );
  assert(created.ok, `create ${title}`);
  const id = data<any>(created).id;
  assert(
    app.call("officeCollab.workflows.submit", { id }, agent).ok,
    `submit ${title}`
  );
  return id;
}

const multiId = createSubmitted("多步会签决定通知", [peerId, managerId]);
const beforeStep = stepMsgs(agent).length;
const beforePeer = stepMsgs(peer).length;
const stepped = app.call(
  "officeCollab.workflows.decide",
  { id: multiId, decision: "approved", comment: "乙先通过" },
  peer
);
assert(stepped.ok, "peer approves first step");
assert(data<any>(stepped).status === "pending", "still pending after first approve");
assert(stepMsgs(agent).length === beforeStep + 1, "creator receives step message");
assert(stepMsgs(peer).length === beforePeer, "approver skips self");
assert(
  stepMsgs(agent).some(
    (m) =>
      m.ref_id === multiId &&
      String(m.body).includes("乙先通过")
  ),
  "step message body"
);

const beforeDone = doneMsgs(agent).length;
const beforeManager = doneMsgs(manager).length;
const finished = app.call(
  "officeCollab.workflows.decide",
  { id: multiId, decision: "approved", comment: "店长终审通过" },
  manager
);
assert(finished.ok, "manager final approve");
assert(data<any>(finished).status === "approved", "status approved");
assert(doneMsgs(agent).length === beforeDone + 1, "creator receives all-passed message");
assert(doneMsgs(manager).length === beforeManager, "final approver skips self");
assert(
  doneMsgs(agent).some(
    (m) => m.ref_id === multiId && String(m.body).includes("店长终审通过")
  ),
  "all-passed message body"
);

const rejectId = createSubmitted("驳回会签决定通知", [peerId]);
assert(
  !app.call(
    "officeCollab.workflows.decide",
    { id: rejectId, decision: "rejected", comment: "x" },
    peer
  ).ok,
  "reject comment too short"
);
const beforeReject = rejectMsgs(agent).length;
const rejected = app.call(
  "officeCollab.workflows.decide",
  { id: rejectId, decision: "rejected", comment: "预算不足驳回" },
  peer
);
assert(rejected.ok, "peer rejects workflow");
assert(data<any>(rejected).status === "rejected", "status rejected");
assert(rejectMsgs(agent).length === beforeReject + 1, "creator receives reject message");
assert(
  rejectMsgs(agent).some(
    (m) => m.ref_id === rejectId && String(m.body).includes("预算不足驳回")
  ),
  "reject message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, agent).ok,
  "mute office"
);
const muteId = createSubmitted("静音会签决定通知", [peerId]);
const beforeMute = doneMsgs(agent).length + rejectMsgs(agent).length + stepMsgs(agent).length;
assert(
  app.call(
    "officeCollab.workflows.decide",
    { id: muteId, decision: "approved", comment: "静音通过" },
    peer
  ).ok,
  "approve while muted"
);
const afterMute = doneMsgs(agent).length + rejectMsgs(agent).length + stepMsgs(agent).length;
assert(afterMute === beforeMute, "muted office suppresses decide message");

console.log(`Workflow decide notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
