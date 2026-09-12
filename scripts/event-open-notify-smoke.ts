import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "event-open-notify-smoke.db")).dbPath
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
const openMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "活动开放报名"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const cross = login("agent_c");
const finance = login("finance");

const event = app.call(
  "officeCollab.events.save",
  {
    title: "开放报名周会",
    start_at: "2026-09-10T10:00:00.000Z",
    end_at: "2026-09-10T11:00:00.000Z",
    location: "一楼会议室",
    capacity: 10,
  },
  manager
);
assert(event.ok, "manager creates event");
const eventId = data<any>(event).id;
assert(
  !app.call("officeCollab.events.open", { id: eventId }, agent).ok,
  "agent cannot open event"
);

const beforeAgent = openMsgs(agent).length;
const beforePeer = openMsgs(peer).length;
const beforeManager = openMsgs(manager).length;
const beforeCross = openMsgs(cross).length;
const beforeFinance = openMsgs(finance).length;
const beforeAdmin = openMsgs(admin).length;

const opened = app.call("officeCollab.events.open", { id: eventId }, manager);
assert(opened.ok, "manager opens event");
assert(data<any>(opened).status === "open", "status open");
assert(openMsgs(agent).length === beforeAgent + 1, "store agent notified");
assert(openMsgs(peer).length === beforePeer + 1, "store peer notified");
assert(
  openMsgs(agent).some(
    (m) =>
      m.ref_id === eventId &&
      String(m.body).includes("开放报名周会") &&
      String(m.body).includes("一楼会议室")
  ),
  "message has title and location"
);
assert(openMsgs(manager).length === beforeManager, "opener does not self-notify");
assert(openMsgs(admin).length === beforeAdmin + 1, "admin notified");
assert(openMsgs(cross).length === beforeCross, "cross-store not notified");
assert(openMsgs(finance).length === beforeFinance, "finance not notified");
assert(
  !app.call("officeCollab.events.open", { id: eventId }, manager).ok,
  "cannot open twice"
);

const muted = app.call(
  "officeCollab.events.save",
  {
    title: "静音开放活动",
    start_at: "2026-09-11T10:00:00.000Z",
    end_at: "2026-09-11T11:00:00.000Z",
  },
  manager
);
assert(muted.ok, "create muted event");
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other channel"
);
const beforeMute = openMsgs(agent).length;
assert(
  app.call("officeCollab.events.open", { id: data<any>(muted).id }, manager).ok,
  "open while muted"
);
assert(openMsgs(agent).length === beforeMute, "muted other suppresses open message");

console.log(`Event open notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
