import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "transfer-template-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "过户模板已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "transfer.templates.save",
    {
      deal_type: "sale",
      node_type: "upd_notify_netsign",
      title: "店长不可改模板",
      sort_order: 1,
      default_assignee_role: "agent",
    },
    manager
  ).ok,
  "manager cannot save transfer template"
);

const created = app.call(
  "transfer.templates.save",
  {
    deal_type: "sale",
    node_type: "upd_notify_netsign",
    title: "网签更新通知节点",
    sort_order: 10,
    default_assignee_role: "agent",
  },
  admin
);
assert(created.ok, "admin creates transfer template");
const templateId = data<any>(created).id;
assert(updateMsgs(manager).length === 0, "create does not send update title");
assert(updateMsgs(agent).length === 0, "agent has no update message after create");

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "transfer.templates.save",
  {
    deal_type: "sale",
    node_type: "upd_notify_netsign",
    title: "网签更新通知节点改",
    sort_order: 11,
    default_assignee_role: "store_manager",
  },
  admin
);
assert(updated.ok, "admin updates existing template");
assert(updateMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(
  updateMsgs(manager).length === beforeManager + 1,
  "manager receives template update message"
);
assert(updateMsgs(agent).length === beforeAgent, "agent not notified on update");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === templateId &&
      m.ref_type === "transfer_template" &&
      String(m.body).includes("网签更新通知节点改") &&
      String(m.body).includes("sale/upd_notify_netsign")
  ),
  "template update message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = updateMsgs(manager).length;
assert(
  app.call(
    "transfer.templates.save",
    {
      deal_type: "sale",
      node_type: "upd_notify_netsign",
      title: "静音后更新",
      sort_order: 12,
      default_assignee_role: "agent",
    },
    admin
  ).ok,
  "update while muted"
);
assert(updateMsgs(manager).length === beforeMute, "muted other suppresses update message");

console.log(
  `Transfer template update notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
