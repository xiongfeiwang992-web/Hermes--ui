import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "event-create-notify-smoke.db")).dbPath
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
const draftMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "活动草稿已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const finance = login("finance");

assert(
  !app.call(
    "officeCollab.events.save",
    {
      title: "经纪人不可建活动",
      start_at: "2026-09-10T10:00:00.000Z",
      end_at: "2026-09-10T11:00:00.000Z",
    },
    agent
  ).ok,
  "agent cannot create event"
);

const beforeAdmin = draftMsgs(admin).length;
const beforeManager = draftMsgs(manager).length;
const beforeAgent = draftMsgs(agent).length;
const beforeFinance = draftMsgs(finance).length;
const created = app.call(
  "officeCollab.events.save",
  {
    title: "活动草稿通知周会",
    start_at: "2026-09-10T10:00:00.000Z",
    end_at: "2026-09-10T11:00:00.000Z",
    location: "一楼会议室",
    capacity: 12,
  },
  manager
);
assert(created.ok, "manager creates event draft");
const eventId = data<any>(created).id;
assert(draftMsgs(admin).length === beforeAdmin + 1, "admin receives draft message");
assert(draftMsgs(manager).length === beforeManager, "manager actor skips self");
assert(draftMsgs(agent).length === beforeAgent, "agent not notified on draft create");
assert(draftMsgs(finance).length === beforeFinance, "finance not notified");
assert(
  draftMsgs(admin).some(
    (m) =>
      m.ref_id === eventId &&
      m.ref_type === "office_event" &&
      String(m.body).includes("活动草稿通知周会")
  ),
  "draft message body refs event"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, admin).ok,
  "mute other"
);
const beforeMute = draftMsgs(admin).length;
assert(
  app.call(
    "officeCollab.events.save",
    {
      title: "静音活动草稿",
      start_at: "2026-09-11T10:00:00.000Z",
      end_at: "2026-09-11T11:00:00.000Z",
    },
    manager
  ).ok,
  "create while muted"
);
assert(draftMsgs(admin).length === beforeMute, "muted other suppresses draft message");

console.log(`Event create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
