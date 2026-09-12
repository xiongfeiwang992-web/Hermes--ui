import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "deal-doc-template-notify-smoke.db")).dbPath
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
const templateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "成交资料模板已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "deal.documents.template.save",
    {
      deal_type: "sale",
      category: "notify_id",
      label: "店长不可建资料模板",
      required: true,
      sort_order: 1,
    },
    manager
  ).ok,
  "manager cannot save deal doc template"
);

const beforeAdmin = templateMsgs(admin).length;
const beforeManager = templateMsgs(manager).length;
const beforeAgent = templateMsgs(agent).length;
const created = app.call(
  "deal.documents.template.save",
  {
    deal_type: "sale",
    category: "notify_id",
    label: "通知用身份证",
    required: true,
    sort_order: 1,
  },
  admin
);
assert(created.ok, "admin creates deal doc template");
const templateId = data<any>(created).id;
assert(templateMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(
  templateMsgs(manager).length === beforeManager + 1,
  "manager receives template message"
);
assert(templateMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  templateMsgs(manager).some(
    (m) =>
      m.ref_id === templateId &&
      m.ref_type === "deal_doc_template" &&
      String(m.body).includes("通知用身份证") &&
      String(m.body).includes("sale/notify_id")
  ),
  "template message body"
);

const beforeUpdate = templateMsgs(manager).length;
assert(
  app.call(
    "deal.documents.template.save",
    {
      deal_type: "sale",
      category: "notify_id",
      label: "通知用身份证改",
      required: false,
      sort_order: 2,
    },
    admin
  ).ok,
  "admin updates existing template"
);
assert(templateMsgs(manager).length === beforeUpdate, "update does not re-notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = templateMsgs(manager).length;
assert(
  app.call(
    "deal.documents.template.save",
    {
      deal_type: "rent",
      category: "notify_lease",
      label: "静音租约",
      required: true,
      sort_order: 1,
    },
    admin
  ).ok,
  "create while muted"
);
assert(templateMsgs(manager).length === beforeMute, "muted other suppresses message");

console.log(`Deal doc template notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
