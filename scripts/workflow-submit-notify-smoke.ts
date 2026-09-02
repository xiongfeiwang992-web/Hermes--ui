import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "workflow-submit-notify-smoke.db")).dbPath
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
const submitMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_workflow" && m.title === "待会签流程"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

assert(
  !app.call("officeCollab.workflows.submit", { id: "missing" }, agent).ok,
  "cannot submit missing workflow"
);

const created = app.call(
  "officeCollab.workflows.create",
  {
    title: "会签提交通知特批",
    content: "申请特批营销费用提交",
    approver_user_ids: [peerId, managerId],
  },
  agent
);
assert(created.ok, "agent creates workflow draft");
const workflowId = data<any>(created).id;
assert(submitMsgs(peer).length === 0, "approver not notified before submit");
assert(submitMsgs(manager).length === 0, "manager not notified before submit");

const beforePeer = submitMsgs(peer).length;
const beforeManager = submitMsgs(manager).length;
const beforeAgent = submitMsgs(agent).length;
const submitted = app.call(
  "officeCollab.workflows.submit",
  { id: workflowId },
  agent
);
assert(submitted.ok, "agent submits workflow");
assert(data<any>(submitted).status === "pending", "status pending");
assert(submitMsgs(peer).length === beforePeer + 1, "peer receives submit message");
assert(
  submitMsgs(manager).length === beforeManager + 1,
  "manager receives submit message"
);
assert(submitMsgs(agent).length === beforeAgent, "creator skips self");
assert(
  submitMsgs(peer).some(
    (m) =>
      m.ref_id === workflowId &&
      m.ref_type === "office_workflow" &&
      String(m.body).includes(agentName) &&
      String(m.body).includes("会签提交通知特批")
  ),
  "submit message body"
);

assert(
  !app.call("officeCollab.workflows.submit", { id: workflowId }, agent).ok,
  "cannot submit twice"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, peer).ok,
  "mute office"
);
const muted = app.call(
  "officeCollab.workflows.create",
  {
    title: "静音会签提交通知",
    content: "静音场景提交正文",
    approver_user_ids: [peerId],
  },
  agent
);
assert(muted.ok, "create mute-test workflow");
const muteId = data<any>(muted).id;
const beforeMute = submitMsgs(peer).length;
assert(
  app.call("officeCollab.workflows.submit", { id: muteId }, agent).ok,
  "submit while muted"
);
assert(submitMsgs(peer).length === beforeMute, "muted office suppresses submit message");

console.log(`Workflow submit notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
