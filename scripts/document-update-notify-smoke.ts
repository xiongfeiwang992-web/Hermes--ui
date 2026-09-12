import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "document-update-notify-smoke.db")).dbPath
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
const updateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_announcement" && String(m.title).endsWith("草稿已更新")
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const created = app.call(
  "officeContent.create",
  {
    document_kind: "announcement",
    category: "news",
    title: "更新通知公告",
    content: "初稿正文内容",
    scope_type: "store",
  },
  manager
);
assert(created.ok, "manager creates announcement draft");
const docId = data<any>(created).id;

assert(
  !app.call(
    "officeContent.update",
    { id: docId, title: "经纪人不可改", content: "x" },
    agent
  ).ok,
  "agent cannot update document"
);

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "officeContent.update",
  {
    id: docId,
    title: "更新通知公告改",
    content: "修订后正文内容",
  },
  manager
);
assert(updated.ok, "manager updates announcement draft");
assert(data<any>(updated).version_no === 2, "version bumped");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives update message");
assert(updateMsgs(manager).length === beforeManager, "updater skips self");
assert(updateMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  updateMsgs(admin).some(
    (m) =>
      m.ref_id === docId &&
      m.title === "公告草稿已更新" &&
      String(m.body).includes("更新通知公告改") &&
      String(m.body).includes("v2")
  ),
  "announcement update message body"
);

const knowledge = app.call(
  "officeContent.create",
  {
    document_kind: "knowledge",
    category: "policy",
    title: "知识更新稿",
    content: "知识初稿",
    scope_type: "company",
  },
  admin
);
assert(knowledge.ok, "admin creates knowledge draft");
const beforeKnowledge = updateMsgs(manager).length;
assert(
  app.call(
    "officeContent.update",
    {
      id: data<any>(knowledge).id,
      title: "知识更新稿改",
      content: "知识修订",
    },
    admin
  ).ok,
  "admin updates knowledge draft"
);
assert(
  updateMsgs(manager).some(
    (m) => m.title === "知识草稿已更新" && String(m.body).includes("知识更新稿改")
  ),
  "manager receives knowledge update message"
);
assert(
  updateMsgs(manager).length === beforeKnowledge + 1,
  "knowledge update notifies manager once"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, admin).ok,
  "mute office"
);
const beforeMute = updateMsgs(admin).length;
assert(
  app.call(
    "officeContent.update",
    { id: docId, title: "静音公告更新", content: "静音正文" },
    manager
  ).ok,
  "update while muted"
);
assert(updateMsgs(admin).length === beforeMute, "muted office suppresses update message");

console.log(`Document update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
