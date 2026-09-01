import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "knowledge-publish-notify-smoke.db")).dbPath
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
const knowledgeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_announcement" && m.title === "新知识库发布"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const draft = app.call(
  "officeContent.create",
  {
    document_kind: "knowledge",
    scope_type: "store",
    category: "training",
    title: "知识库通知手册",
    content: "发布知识库时应通知可见范围员工。",
  },
  manager
);
assert(draft.ok, "manager creates store knowledge draft");
const docId = data<any>(draft).id;

const beforeAdmin = knowledgeMsgs(admin).length;
const beforeManager = knowledgeMsgs(manager).length;
const beforeAgent = knowledgeMsgs(agent).length;
const beforePeer = knowledgeMsgs(peer).length;
assert(app.call("officeContent.publish", { id: docId }, manager).ok, "publish knowledge");
assert(knowledgeMsgs(admin).length === beforeAdmin + 1, "admin receives knowledge message");
assert(knowledgeMsgs(manager).length === beforeManager, "publisher does not self-notify");
assert(knowledgeMsgs(agent).length === beforeAgent + 1, "same-store agent receives message");
assert(
  knowledgeMsgs(agent).some(
    (m) => m.ref_id === docId && String(m.body).includes("知识库通知手册")
  ),
  "knowledge message body"
);

const companyDraft = app.call(
  "officeContent.create",
  {
    document_kind: "knowledge",
    scope_type: "company",
    category: "process",
    title: "全公司知识库条目",
    content: "公司范围知识库发布通知。",
  },
  admin
);
assert(companyDraft.ok, "admin creates company knowledge");
const companyId = data<any>(companyDraft).id;
const beforePeerCompany = knowledgeMsgs(peer).length;
assert(app.call("officeContent.publish", { id: companyId }, admin).ok, "publish company knowledge");
assert(
  knowledgeMsgs(peer).length === beforePeerCompany + 1,
  "peer receives company knowledge message"
);
assert(
  knowledgeMsgs(peer).some((m) => m.ref_id === companyId),
  "company knowledge refs document"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, agent).ok,
  "mute office"
);
const mutedDraft = app.call(
  "officeContent.create",
  {
    document_kind: "knowledge",
    scope_type: "store",
    category: "other",
    title: "静音知识库",
    content: "静音渠道不应收到知识库通知。",
  },
  manager
);
assert(mutedDraft.ok, "create muted knowledge draft");
const beforeMute = knowledgeMsgs(agent).length;
const beforeMutePeer = knowledgeMsgs(peer).length;
assert(
  app.call("officeContent.publish", { id: data<any>(mutedDraft).id }, manager).ok,
  "publish while muted"
);
assert(knowledgeMsgs(agent).length === beforeMute, "muted office suppresses knowledge message");
assert(
  knowledgeMsgs(peer).length === beforeMutePeer + 1,
  "unmuted peer still receives knowledge message"
);

void beforePeer;
console.log(`Knowledge publish notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
