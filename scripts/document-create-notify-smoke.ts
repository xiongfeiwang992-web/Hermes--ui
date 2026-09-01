import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "document-create-notify-smoke.db")).dbPath
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
const announcementDraftMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_announcement" && m.title === "公告草稿已创建"
  );
const knowledgeDraftMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_announcement" && m.title === "知识草稿已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "officeContent.create",
    {
      document_kind: "announcement",
      category: "news",
      title: "经纪人不可建公告",
      content: "正文内容",
      scope_type: "store",
    },
    agent
  ).ok,
  "agent cannot create document"
);

const beforeAdmin = announcementDraftMsgs(admin).length;
const beforeManager = announcementDraftMsgs(manager).length;
const beforeAgent = announcementDraftMsgs(agent).length;
const created = app.call(
  "officeContent.create",
  {
    document_kind: "announcement",
    category: "news",
    title: "公告草稿通知标题",
    content: "公告草稿正文内容",
    scope_type: "store",
  },
  manager
);
assert(created.ok, "manager creates announcement draft");
const docId = data<any>(created).id;
assert(
  announcementDraftMsgs(admin).length === beforeAdmin + 1,
  "admin receives announcement draft message"
);
assert(
  announcementDraftMsgs(manager).length === beforeManager,
  "manager actor skips self"
);
assert(
  announcementDraftMsgs(agent).length === beforeAgent,
  "agent not notified on draft create"
);
assert(
  announcementDraftMsgs(admin).some(
    (m) =>
      m.ref_id === docId &&
      m.ref_type === "office_document" &&
      String(m.body).includes("公告草稿通知标题")
  ),
  "announcement draft message body"
);

const beforeKnowledge = knowledgeDraftMsgs(admin).length;
const knowledge = app.call(
  "officeContent.create",
  {
    document_kind: "knowledge",
    category: "policy",
    title: "知识草稿通知标题",
    content: "知识草稿正文内容",
    scope_type: "company",
  },
  admin
);
assert(knowledge.ok, "admin creates knowledge draft");
assert(
  knowledgeDraftMsgs(manager).some(
    (m) =>
      m.ref_id === data<any>(knowledge).id &&
      String(m.body).includes("知识草稿通知标题")
  ),
  "manager receives knowledge draft message"
);
assert(
  knowledgeDraftMsgs(admin).length === beforeKnowledge,
  "admin actor skips knowledge self"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, admin).ok,
  "mute office"
);
const beforeMute = announcementDraftMsgs(admin).length;
assert(
  app.call(
    "officeContent.create",
    {
      document_kind: "announcement",
      category: "news",
      title: "静音公告草稿",
      content: "静音正文",
      scope_type: "store",
    },
    manager
  ).ok,
  "create while muted"
);
assert(
  announcementDraftMsgs(admin).length === beforeMute,
  "muted office suppresses draft message"
);

console.log(`Document create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
