import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "lead-status-notify-smoke.db")).dbPath
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
const statusMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "marketing" &&
      (m.title === "营销线索已流失" || m.title === "营销线索已无效")
  );

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

let phoneSeq = 500;
function createLead(name: string, byToken: string) {
  phoneSeq += 1;
  const lead = app.call(
    "marketing.leads.create",
    {
      contact_name: name,
      contact_phone: `1398${String(phoneSeq).padStart(7, "0")}`,
      channel: "walk_in",
      intent: "buy",
      need: "三房",
    },
    byToken
  );
  assert(lead.ok, `create ${name}`);
  return data<any>(lead).id;
}

const lostId = createLead("流失通知线索", agentA);
assert(
  app.call(
    "marketing.leads.assign",
    { id: lostId, assignee_user_id: agentBId },
    manager
  ).ok,
  "assign lost lead to agentB"
);
assert(
  app.call("marketing.leads.status", { id: lostId, status: "contacting" }, agentB).ok,
  "agentB starts contacting"
);
const beforeA = statusMsgs(agentA).length;
const beforeB = statusMsgs(agentB).length;
const beforeM = statusMsgs(manager).length;
assert(
  !app.call("marketing.leads.status", { id: lostId, status: "lost", reason: "" }, manager).ok,
  "lost requires reason"
);
const lost = app.call(
  "marketing.leads.status",
  { id: lostId, status: "lost", reason: "预算不符" },
  manager
);
assert(lost.ok, "manager marks lost");
assert(data<any>(lost).status === "lost", "status lost");
assert(statusMsgs(agentA).length === beforeA + 1, "creator receives lost message");
assert(statusMsgs(agentB).length === beforeB + 1, "assignee receives lost message");
assert(statusMsgs(manager).length === beforeM, "actor does not self-notify");
assert(
  statusMsgs(agentA).some(
    (m) =>
      m.ref_id === lostId &&
      m.title === "营销线索已流失" &&
      String(m.body).includes("流失通知线索") &&
      String(m.body).includes("预算不符")
  ),
  "lost message body"
);

const invalidId = createLead("无效通知线索", agentA);
assert(
  app.call(
    "marketing.leads.assign",
    { id: invalidId, assignee_user_id: agentBId },
    manager
  ).ok,
  "assign invalid lead"
);
const beforeInvA = statusMsgs(agentA).length;
assert(
  app.call(
    "marketing.leads.status",
    { id: invalidId, status: "invalid", reason: "空号" },
    agentB
  ).ok,
  "assignee marks invalid"
);
assert(
  statusMsgs(agentA).some(
    (m) => m.ref_id === invalidId && m.title === "营销线索已无效"
  ),
  "invalid title to creator"
);
assert(statusMsgs(agentA).length === beforeInvA + 1, "invalid notifies creator once");
assert(
  !statusMsgs(agentB).some((m) => m.ref_id === invalidId),
  "assignee actor skips self-notify on invalid"
);

const selfId = createLead("自标流失线索", agentA);
assert(
  app.call("marketing.leads.status", { id: selfId, status: "lost", reason: "自行放弃" }, agentA)
    .ok,
  "creator marks own lead lost"
);
assert(
  !statusMsgs(agentA).some((m) => m.ref_id === selfId),
  "self lost skips notify"
);

const mutedId = createLead("静音流失线索", agentA);
assert(
  app.call(
    "marketing.leads.assign",
    { id: mutedId, assignee_user_id: agentBId },
    manager
  ).ok,
  "assign muted lead"
);
assert(
  app.call("message.subscriptions.save", { channels: { marketing: false } }, agentA).ok,
  "mute marketing"
);
const beforeMute = statusMsgs(agentA).length;
assert(
  app.call(
    "marketing.leads.status",
    { id: mutedId, status: "invalid", reason: "静音测试" },
    agentB
  ).ok,
  "invalid while muted"
);
assert(statusMsgs(agentA).length === beforeMute, "muted marketing suppresses status message");

console.log(`Lead status notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
