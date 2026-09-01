import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "dictionary-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "数据字典已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "config.dictionary.upsert",
    {
      dict_type: "follow_method",
      value: "upd_notify_video",
      label: "店长不可改字典",
      sort_order: 99,
    },
    manager
  ).ok,
  "manager cannot upsert dictionary"
);

const created = app.call(
  "config.dictionary.upsert",
  {
    dict_type: "follow_method",
    value: "upd_notify_video",
    label: "更新通知视频沟通",
    sort_order: 99,
  },
  admin
);
assert(created.ok, "admin creates dictionary entry");
const dictId = data<any>(created).id;
assert(updateMsgs(manager).length === 0, "create does not send update title");
assert(updateMsgs(agent).length === 0, "agent has no update message after create");

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "config.dictionary.upsert",
  {
    dict_type: "follow_method",
    value: "upd_notify_video",
    label: "更新通知视频沟通改",
    sort_order: 100,
  },
  admin
);
assert(updated.ok, "admin updates dictionary entry");
assert(updateMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(
  updateMsgs(manager).length === beforeManager + 1,
  "manager receives dictionary update message"
);
assert(updateMsgs(agent).length === beforeAgent, "agent not notified on update");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === dictId &&
      m.ref_type === "dictionary" &&
      String(m.body).includes("follow_method") &&
      String(m.body).includes("更新通知视频沟通改") &&
      String(m.body).includes("upd_notify_video")
  ),
  "dictionary update message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = updateMsgs(manager).length;
assert(
  app.call(
    "config.dictionary.upsert",
    {
      dict_type: "follow_method",
      value: "upd_notify_video",
      label: "静音后更新",
      sort_order: 101,
    },
    admin
  ).ok,
  "update while muted"
);
assert(updateMsgs(manager).length === beforeMute, "muted other suppresses update message");

console.log(`Dictionary update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
