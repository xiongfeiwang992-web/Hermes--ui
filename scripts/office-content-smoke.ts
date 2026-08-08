import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "office-content-smoke.db"));
const app = createApp(seeded.dbPath);
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
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentC = login("agent_c");

check(
  data<any>(app.call("officeContent.options", {}, agentA)).stores.length === 0,
  "ordinary employee receives no content management options"
);
check(
  data<any>(app.call("officeContent.options", {}, manager)).stores.length === 1,
  "manager options contain only own store"
);
check(
  data<any>(app.call("officeContent.options", {}, admin)).stores.length === 2,
  "admin options contain company stores"
);
check(
  !app.call(
    "officeContent.create",
    {
      document_kind: "announcement",
      category: "news",
      title: "无权公告",
      content: "正文",
    },
    agentA
  ).ok,
  "ordinary employee cannot create office content"
);
check(
  !app.call(
    "officeContent.create",
    {
      document_kind: "unknown",
      category: "news",
      title: "无效类型",
      content: "正文",
    },
    admin
  ).ok,
  "office content kind validated"
);
check(
  !app.call(
    "officeContent.create",
    {
      document_kind: "knowledge",
      category: "invalid",
      title: "无效分类",
      content: "正文",
    },
    admin
  ).ok,
  "office content category validated"
);
check(
  !app.call(
    "officeContent.create",
    {
      document_kind: "knowledge",
      category: "training",
      title: "",
      content: "",
    },
    admin
  ).ok,
  "office content requires title and body"
);

const storeAnnouncement = app.call(
  "officeContent.create",
  {
    document_kind: "announcement",
    scope_type: "company",
    store_id: seeded.storeB,
    category: "policy",
    title: "一号店晨会制度",
    content: "每日九点前完成晨会签到。",
    is_pinned: true,
  },
  manager
);
check(
  storeAnnouncement.ok &&
    data<any>(storeAnnouncement).status === "draft" &&
    data<any>(storeAnnouncement).version_no === 1,
  "manager creates store announcement draft"
);
const storeAnnouncementId = data<any>(storeAnnouncement).id;
const managerDraft = data<any[]>(
  app.call("officeContent.list", { status: "draft" }, manager)
).find((item) => item.id === storeAnnouncementId);
check(
  managerDraft?.scope_type === "store" && managerDraft.store_id === seeded.storeA,
  "manager content scope is forced to own store"
);
check(
  data<any[]>(app.call("officeContent.list", {}, agentA)).length === 0,
  "employee cannot see announcement draft"
);
check(
  data<any[]>(app.call("officeContent.list", {}, agentC)).length === 0,
  "other store employee cannot see announcement draft"
);
check(
  !app.call("officeContent.publish", { id: storeAnnouncementId }, agentA).ok,
  "ordinary employee cannot publish announcement"
);
check(
  app.call("officeContent.publish", { id: storeAnnouncementId }, manager).ok,
  "manager publishes own store announcement"
);
check(
  data<any[]>(app.call("officeContent.list", {}, agentA)).some(
    (item) => item.id === storeAnnouncementId && item.is_pinned === 1
  ),
  "same-store employee sees published announcement"
);
check(
  data<any[]>(app.call("officeContent.list", {}, agentC)).length === 0,
  "other-store employee cannot see store announcement"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) =>
      message.kind === "office_announcement" && message.ref_id === storeAnnouncementId
  ),
  "same-store employee receives announcement message"
);
check(
  !data<any[]>(app.call("message.list", {}, agentC)).some(
    (message) => message.ref_id === storeAnnouncementId
  ),
  "other-store employee receives no store announcement message"
);
check(
  data<any>(app.call("officeContent.unread", {}, agentA)).announcements === 1,
  "published announcement enters unread count"
);
check(
  !app.call("officeContent.read", { id: storeAnnouncementId }, agentC).ok,
  "out-of-scope employee cannot create read receipt"
);
check(
  app.call("officeContent.read", { id: storeAnnouncementId }, agentA).ok,
  "employee records announcement read receipt"
);
check(
  app.call("officeContent.read", { id: storeAnnouncementId }, agentA).ok,
  "read receipt is idempotent"
);
check(
  data<any>(app.call("officeContent.unread", {}, agentA)).count === 0,
  "read announcement leaves unread count"
);
check(
  data<any[]>(
    app.call("officeContent.list", { document_kind: "announcement" }, manager)
  ).find((item) => item.id === storeAnnouncementId)?.read_count === 1,
  "manager sees distinct read count"
);

check(
  app.call(
    "officeContent.update",
    {
      id: storeAnnouncementId,
      title: "一号店晨会制度（修订）",
      content: "每日八点五十分前完成晨会签到。",
      category: "policy",
      is_pinned: false,
    },
    manager
  ).ok,
  "manager revises published announcement into new draft"
);
check(
  data<any[]>(app.call("officeContent.list", {}, agentA)).length === 0,
  "revised draft is hidden until republished"
);
check(
  app.call("officeContent.publish", { id: storeAnnouncementId }, manager).ok,
  "manager republishes revised announcement"
);
const versionsForEmployee = app.call(
  "officeContent.versions",
  { id: storeAnnouncementId },
  agentA
);
check(
  versionsForEmployee.ok &&
    data<any[]>(versionsForEmployee).length === 2 &&
    data<any[]>(versionsForEmployee)[0].version_no === 2,
  "published document exposes immutable version history"
);

const companyAnnouncement = app.call(
  "officeContent.create",
  {
    document_kind: "announcement",
    scope_type: "company",
    category: "news",
    title: "公司统一公告",
    content: "全员可见的业务通知。",
  },
  admin
);
const companyAnnouncementId = data<any>(companyAnnouncement).id;
check(companyAnnouncement.ok, "admin creates company announcement");
check(
  app.call("officeContent.publish", { id: companyAnnouncementId }, admin).ok,
  "admin publishes company announcement"
);
check(
  data<any[]>(app.call("officeContent.list", {}, agentC)).some(
    (item) => item.id === companyAnnouncementId
  ) &&
    data<any[]>(app.call("officeContent.list", {}, finance)).some(
      (item) => item.id === companyAnnouncementId
    ),
  "company announcement is visible across stores and roles"
);
check(
  !app.call(
    "officeContent.update",
    {
      id: companyAnnouncementId,
      title: "越权修改",
      content: "越权",
    },
    manager
  ).ok,
  "manager cannot edit company announcement"
);

const storeKnowledge = app.call(
  "officeContent.create",
  {
    document_kind: "knowledge",
    scope_type: "store",
    store_id: seeded.storeA,
    category: "training",
    title: "房源验真操作手册",
    content: "步骤一：核验产权资料。",
  },
  admin
);
const storeKnowledgeId = data<any>(storeKnowledge).id;
check(storeKnowledge.ok, "admin creates store knowledge draft");
const fixture = path.resolve("data", "office-content-fixture.txt");
fs.writeFileSync(fixture, "office attachment", "utf8");
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "office_document",
      parent_id: storeKnowledgeId,
      category: "office_document",
      name: "越权附件.txt",
      local_path: fixture,
    },
    agentA
  ).ok,
  "ordinary employee cannot upload draft document attachment"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "office_document",
      parent_id: storeKnowledgeId,
      category: "invalid",
      name: "错误分类.txt",
      local_path: fixture,
    },
    admin
  ).ok,
  "office attachment category validated"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "office_document",
      parent_id: storeKnowledgeId,
      category: "office_document",
      name: "验真手册.txt",
      local_path: fixture,
    },
    admin
  ).ok,
  "managerial user uploads knowledge attachment"
);
check(
  !app.call(
    "attachment.list",
    { parent_type: "office_document", parent_id: storeKnowledgeId },
    agentA
  ).ok,
  "employee cannot list draft attachment"
);
check(
  app.call("officeContent.publish", { id: storeKnowledgeId }, admin).ok,
  "admin publishes store knowledge article"
);
check(
  data<any[]>(
    app.call(
      "attachment.list",
      { parent_type: "office_document", parent_id: storeKnowledgeId },
      agentA
    )
  ).length === 1,
  "in-scope employee lists published knowledge attachment"
);
check(
  !app.call(
    "attachment.list",
    { parent_type: "office_document", parent_id: storeKnowledgeId },
    agentC
  ).ok,
  "other-store employee cannot list knowledge attachment"
);
check(
  !data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.ref_id === storeKnowledgeId
  ),
  "knowledge publication does not create announcement broadcast"
);
check(
  data<any>(app.call("officeContent.unread", {}, agentA)).knowledge === 1,
  "published knowledge enters unread count"
);
check(
  app.call("officeContent.archive", { id: storeKnowledgeId }, admin).ok,
  "admin archives published knowledge article"
);
check(
  !data<any[]>(app.call("officeContent.list", {}, agentA)).some(
    (item) => item.id === storeKnowledgeId
  ),
  "archived knowledge is hidden from employee"
);
check(
  data<any[]>(app.call("officeContent.list", { status: "archived" }, admin)).some(
    (item) => item.id === storeKnowledgeId
  ),
  "admin retains archived knowledge visibility"
);
check(
  !app.call("officeContent.update", { id: storeKnowledgeId, title: "归档修改" }, admin).ok,
  "archived document is immutable"
);
check(
  !app.call("officeContent.archive", { id: storeKnowledgeId }, admin).ok,
  "archived document cannot be archived twice"
);
check(
  !app.call(
    "suite.create",
    {
      module: "office",
      record_type: "announcement",
      title: "通用公告",
      data: {},
    },
    manager
  ).ok,
  "generic announcement record is disabled"
);
check(
  !app.call(
    "suite.create",
    {
      module: "office",
      record_type: "knowledge",
      title: "通用知识",
      data: {},
    },
    manager
  ).ok,
  "generic knowledge record is disabled"
);
const audits = data<any[]>(
  app.call("audit.list", { entity_type: "office_document" }, admin)
);
check(
  audits.some((item) => item.action === "office_document.publish") &&
    audits.some((item) => item.action === "office_document.archive"),
  "office content lifecycle writes audit records"
);

console.log(`Office content smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
