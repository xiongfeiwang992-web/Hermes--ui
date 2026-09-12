import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "transfer-template-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "过户模板已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "transfer.templates.save",
    {
      deal_type: "sale",
      node_type: "notify_netsign",
      title: "店长不可建模板",
      sort_order: 1,
      default_assignee_role: "agent",
    },
    manager
  ).ok,
  "manager cannot save transfer template"
);

const beforeAdmin = templateMsgs(admin).length;
const beforeManager = templateMsgs(manager).length;
const beforeAgent = templateMsgs(agent).length;
const created = app.call(
  "transfer.templates.save",
  {
    deal_type: "sale",
    node_type: "notify_netsign",
    title: "网签通知节点",
    sort_order: 10,
    default_assignee_role: "agent",
  },
  admin
);
assert(created.ok, "admin creates transfer template");
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
      m.ref_type === "transfer_template" &&
      String(m.body).includes("网签通知节点") &&
      String(m.body).includes("sale/notify_netsign")
  ),
  "template message body"
);

const beforeUpdate = templateMsgs(manager).length;
assert(
  app.call(
    "transfer.templates.save",
    {
      deal_type: "sale",
      node_type: "notify_netsign",
      title: "网签通知节点改",
      sort_order: 11,
      default_assignee_role: "store_manager",
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
    "transfer.templates.save",
    {
      deal_type: "rent",
      node_type: "notify_handover",
      title: "静音交房节点",
      sort_order: 1,
      default_assignee_role: "agent",
    },
    admin
  ).ok,
  "create while muted"
);
assert(templateMsgs(manager).length === beforeMute, "muted other suppresses message");

console.log(`Transfer template notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
