import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "office-document-archive-notify-smoke.db"));
const app = createApp(seeded.dbPath);

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
const archiveMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_announcement" && m.title === "公告已归档"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentC = login("agent_c");

const storeAnnouncement = app.call(
  "officeContent.create",
  {
    document_kind: "announcement",
    scope_type: "store",
    title: "归档通知本店公告",
    content: "本店公告归档后应通知本店员工",
    category: "policy",
  },
  manager
);
assert(storeAnnouncement.ok, "manager creates store announcement");
const storeAnnouncementId = data<any>(storeAnnouncement).id;
assert(
  app.call("officeContent.publish", { id: storeAnnouncementId }, manager).ok,
  "manager publishes store announcement"
);

const beforeAgentA = archiveMsgs(agentA).length;
const beforeAgentC = archiveMsgs(agentC).length;
const beforeManager = archiveMsgs(manager).length;
const archived = app.call(
  "officeContent.archive",
  { id: storeAnnouncementId },
  manager
);
assert(archived.ok, "manager archives store announcement");
assert(data<any>(archived).status === "archived", "status archived");

const afterAgentA = archiveMsgs(agentA);
assert(afterAgentA.length === beforeAgentA + 1, "same-store agent receives archive message");
assert(afterAgentA[0].ref_id === storeAnnouncementId, "message refs document");
assert(String(afterAgentA[0].body).includes("归档通知本店公告"), "body has title");
assert(
  archiveMsgs(agentC).length === beforeAgentC,
  "other-store agent receives no store archive message"
);
assert(archiveMsgs(manager).length === beforeManager, "archiver does not self-notify");
assert(
  !app.call("officeContent.archive", { id: storeAnnouncementId }, manager).ok,
  "cannot archive twice"
);

const knowledge = app.call(
  "officeContent.create",
  {
    document_kind: "knowledge",
    scope_type: "store",
    title: "知识归档不广播",
    content: "知识文章归档不应发送公告消息",
    category: "training",
  },
  manager
);
assert(knowledge.ok, "manager creates knowledge");
const knowledgeId = data<any>(knowledge).id;
assert(
  app.call("officeContent.publish", { id: knowledgeId }, manager).ok,
  "publish knowledge"
);
const beforeKnowledge = archiveMsgs(agentA).length;
assert(
  app.call("officeContent.archive", { id: knowledgeId }, manager).ok,
  "archive knowledge"
);
assert(
  archiveMsgs(agentA).length === beforeKnowledge,
  "knowledge archive does not broadcast"
);

const muteAnnouncement = app.call(
  "officeContent.create",
  {
    document_kind: "announcement",
    scope_type: "store",
    title: "静音归档公告",
    content: "静音办公频道后不应收到归档消息",
    category: "policy",
  },
  manager
);
assert(muteAnnouncement.ok, "create mute-test announcement");
const muteId = data<any>(muteAnnouncement).id;
assert(app.call("officeContent.publish", { id: muteId }, manager).ok, "publish mute-test");
assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, agentA).ok,
  "mute office channel"
);
const beforeMute = archiveMsgs(agentA).length;
assert(app.call("officeContent.archive", { id: muteId }, manager).ok, "archive while muted");
assert(archiveMsgs(agentA).length === beforeMute, "muted office suppresses archive message");

const companyAnnouncement = app.call(
  "officeContent.create",
  {
    document_kind: "announcement",
    scope_type: "company",
    title: "全公司归档公告",
    content: "公司级公告归档应通知各店",
    category: "policy",
  },
  admin
);
assert(companyAnnouncement.ok, "admin creates company announcement");
const companyId = data<any>(companyAnnouncement).id;
assert(
  app.call("officeContent.publish", { id: companyId }, admin).ok,
  "admin publishes company announcement"
);
assert(
  app.call("message.subscriptions.save", { channels: { office: true } }, agentA).ok,
  "unmute office for agentA"
);
const beforeCompanyA = archiveMsgs(agentA).length;
const beforeCompanyC = archiveMsgs(agentC).length;
assert(
  app.call("officeContent.archive", { id: companyId }, admin).ok,
  "admin archives company announcement"
);
assert(
  archiveMsgs(agentA).length === beforeCompanyA + 1,
  "store A receives company archive message"
);
assert(
  archiveMsgs(agentC).length === beforeCompanyC + 1,
  "store B receives company archive message"
);

console.log(
  `Office document archive notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
