import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "dictionary-upsert-notify-smoke.db")).dbPath
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
const dictMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "数据字典已新增"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "config.dictionary.upsert",
    { dict_type: "follow_method", value: "notify_video", label: "通知视频沟通", sort_order: 99 },
    manager
  ).ok,
  "manager cannot upsert dictionary"
);

const beforeAdmin = dictMsgs(admin).length;
const beforeManager = dictMsgs(manager).length;
const beforeAgent = dictMsgs(agent).length;
const created = app.call(
  "config.dictionary.upsert",
  {
    dict_type: "follow_method",
    value: "notify_video",
    label: "通知视频沟通",
    sort_order: 99,
  },
  admin
);
assert(created.ok, "admin creates dictionary entry");
const dictId = data<any>(created).id;
assert(dictMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(dictMsgs(manager).length === beforeManager + 1, "manager receives dictionary message");
assert(dictMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  dictMsgs(manager).some(
    (m) =>
      m.ref_id === dictId &&
      m.ref_type === "dictionary" &&
      String(m.body).includes("follow_method") &&
      String(m.body).includes("通知视频沟通") &&
      String(m.body).includes("notify_video")
  ),
  "dictionary message body"
);

const beforeUpdate = dictMsgs(manager).length;
assert(
  app.call(
    "config.dictionary.upsert",
    {
      dict_type: "follow_method",
      value: "notify_video",
      label: "通知视频沟通改",
      sort_order: 100,
    },
    admin
  ).ok,
  "admin updates dictionary entry"
);
assert(dictMsgs(manager).length === beforeUpdate, "update does not re-notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = dictMsgs(manager).length;
assert(
  app.call(
    "config.dictionary.upsert",
    {
      dict_type: "follow_method",
      value: "notify_mute",
      label: "静音字典项",
      sort_order: 101,
    },
    admin
  ).ok,
  "create while muted"
);
assert(dictMsgs(manager).length === beforeMute, "muted other suppresses message");

console.log(`Dictionary upsert notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
