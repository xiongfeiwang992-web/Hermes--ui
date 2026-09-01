import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "event-signup-notify-smoke.db")).dbPath
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
const signupMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "活动有人报名"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

const event = app.call(
  "officeCollab.events.save",
  {
    title: "报名通知活动",
    location: "一楼会议室",
    start_at: "2026-10-01T10:00",
    end_at: "2026-10-01T12:00",
    capacity: 10,
  },
  manager
);
assert(event.ok, "create event");
const eventId = data<any>(event).id;
assert(
  !app.call("officeCollab.events.signup", { id: eventId }, agent).ok,
  "cannot signup draft"
);
assert(app.call("officeCollab.events.open", { id: eventId }, manager).ok, "open event");

const beforeManager = signupMsgs(manager).length;
const beforeAgent = signupMsgs(agent).length;
const signed = app.call("officeCollab.events.signup", { id: eventId }, agent);
assert(signed.ok, "agent signs up");
assert(signupMsgs(manager).length === beforeManager + 1, "creator receives signup message");
assert(signupMsgs(agent).length === beforeAgent, "signer does not self-notify");
assert(
  signupMsgs(manager).some(
    (m) =>
      m.ref_id === data<any>(signed).id &&
      String(m.body).includes("报名通知活动") &&
      String(m.body).includes(agentName)
  ),
  "signup message body"
);
assert(
  !app.call("officeCollab.events.signup", { id: eventId }, agent).ok,
  "duplicate signup blocked"
);

const beforePeer = signupMsgs(manager).length;
assert(app.call("officeCollab.events.signup", { id: eventId }, peer).ok, "peer signs up");
assert(signupMsgs(manager).length === beforePeer + 1, "second signup notifies");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const event2 = app.call(
  "officeCollab.events.save",
  {
    title: "静音报名活动",
    start_at: "2026-10-02T10:00",
    end_at: "2026-10-02T11:00",
    capacity: 5,
  },
  manager
);
assert(event2.ok, "create muted event");
assert(
  app.call("officeCollab.events.open", { id: data<any>(event2).id }, manager).ok,
  "open muted event"
);
const beforeMute = signupMsgs(manager).length;
assert(
  app.call("officeCollab.events.signup", { id: data<any>(event2).id }, agent).ok,
  "signup while muted"
);
assert(signupMsgs(manager).length === beforeMute, "muted other suppresses signup message");

console.log(`Event signup notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
