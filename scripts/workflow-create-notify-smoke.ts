import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "workflow-create-notify-smoke.db")).dbPath
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
const draftMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_workflow" && m.title === "会签草稿已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const finance = login("finance");
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

assert(
  !app.call(
    "officeCollab.workflows.create",
    {
      title: "财务不可建会签",
      content: "测试内容足够",
      approver_user_ids: [peerId],
    },
    finance
  ).ok,
  "finance cannot create workflow"
);

const beforeAdmin = draftMsgs(admin).length;
const beforeManager = draftMsgs(manager).length;
const beforeAgent = draftMsgs(agent).length;
const beforePeer = draftMsgs(peer).length;
const created = app.call(
  "officeCollab.workflows.create",
  {
    title: "会签草稿通知特批",
    content: "申请特批营销费用草稿",
    approver_user_ids: [peerId],
  },
  agent
);
assert(created.ok, "agent creates workflow draft");
const workflowId = data<any>(created).id;
assert(draftMsgs(admin).length === beforeAdmin + 1, "admin receives draft message");
assert(draftMsgs(manager).length === beforeManager + 1, "manager receives draft message");
assert(draftMsgs(agent).length === beforeAgent, "creator skips self");
assert(
  draftMsgs(peer).length === beforePeer,
  "approver not notified until submit"
);
assert(
  draftMsgs(admin).some(
    (m) =>
      m.ref_id === workflowId &&
      m.ref_type === "office_workflow" &&
      String(m.body).includes("会签草稿通知特批")
  ),
  "draft message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, manager).ok,
  "mute office"
);
const beforeMute = draftMsgs(manager).length;
assert(
  app.call(
    "officeCollab.workflows.create",
    {
      title: "静音会签草稿",
      content: "静音测试内容足够",
      approver_user_ids: [peerId],
    },
    agent
  ).ok,
  "create while muted"
);
assert(draftMsgs(manager).length === beforeMute, "muted office suppresses draft message");

console.log(`Workflow create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
