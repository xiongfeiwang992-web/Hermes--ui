import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "leave-create-notify-smoke.db")).dbPath
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
const pendingMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "leave_pending" && m.title === "请假申请待审批"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

const beforeAdmin = pendingMsgs(admin).length;
const beforeManager = pendingMsgs(manager).length;
const beforeAgent = pendingMsgs(agent).length;
const beforePeer = pendingMsgs(peer).length;

const created = app.call(
  "leave.create",
  {
    leave_type: "personal",
    start_at: "2026-11-01T01:00:00.000Z",
    end_at: "2026-11-01T05:00:00.000Z",
    reason: "请假创建通知测试",
  },
  agent
);
assert(created.ok, "agent creates leave");
const leaveId = data<any>(created).id;
assert(data<any>(created).duration_hours === 4, "duration hours computed");

assert(pendingMsgs(admin).length === beforeAdmin + 1, "admin receives pending leave");
assert(
  pendingMsgs(manager).length === beforeManager + 1,
  "manager receives pending leave"
);
assert(pendingMsgs(agent).length === beforeAgent, "applicant skips self");
assert(pendingMsgs(peer).length === beforePeer, "peer agent not notified");
assert(
  pendingMsgs(manager).some(
    (m) =>
      m.ref_id === leaveId &&
      m.ref_type === "leave_request" &&
      String(m.body).includes(agentName) &&
      String(m.body).includes("4")
  ),
  "pending leave message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, manager).ok,
  "mute hr"
);
const beforeMute = pendingMsgs(manager).length;
assert(
  app.call(
    "leave.create",
    {
      leave_type: "sick",
      start_at: "2026-11-02T01:00:00.000Z",
      end_at: "2026-11-02T03:00:00.000Z",
      reason: "静音请假创建",
    },
    agent
  ).ok,
  "create while muted"
);
assert(pendingMsgs(manager).length === beforeMute, "muted hr suppresses pending leave");

const managerLeave = app.call(
  "leave.create",
  {
    leave_type: "annual",
    start_at: "2026-11-03T01:00:00.000Z",
    end_at: "2026-11-03T02:00:00.000Z",
    reason: "店长自请创建通知",
  },
  manager
);
assert(managerLeave.ok, "manager creates own leave");
assert(
  pendingMsgs(manager).length === beforeMute,
  "manager skips self on own leave"
);
assert(
  pendingMsgs(admin).some((m) => m.ref_id === data<any>(managerLeave).id),
  "admin still notified when manager applies"
);

console.log(`Leave create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
