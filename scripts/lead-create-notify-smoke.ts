import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "lead-create-notify-smoke.db")).dbPath
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
const createMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "marketing" && m.title === "新营销线索已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const beforeAdmin = createMsgs(admin).length;
const beforeManager = createMsgs(manager).length;
const beforeAgent = createMsgs(agent).length;
const created = app.call(
  "marketing.leads.create",
  {
    contact_name: "登记通知线索",
    contact_phone: "13991001111",
    intent: "buy",
    channel: "phone",
    need: "两室刚需",
  },
  agent
);
assert(created.ok, "agent creates lead");
const leadId = data<any>(created).id;
assert(createMsgs(admin).length === beforeAdmin + 1, "admin receives create message");
assert(createMsgs(manager).length === beforeManager + 1, "manager receives create message");
assert(createMsgs(agent).length === beforeAgent, "creator does not self-notify");
assert(
  createMsgs(manager).some(
    (m) =>
      m.ref_id === leadId &&
      String(m.body).includes("登记通知线索") &&
      String(m.body).includes("phone")
  ),
  "create message body"
);

const beforeMgrSelf = createMsgs(manager).length;
const beforeAdmin2 = createMsgs(admin).length;
const beforeAgentAssign = data<any[]>(app.call("message.list", {}, agent)).filter(
  (m) => m.kind === "marketing" && m.title === "新营销线索已分配"
).length;
const mgrLead = app.call(
  "marketing.leads.create",
  {
    contact_name: "店长分派线索",
    contact_phone: "13991002222",
    intent: "rent",
    channel: "website",
    assignee_user_id: agentId,
  },
  manager
);
assert(mgrLead.ok, "manager creates assigned lead");
assert(createMsgs(manager).length === beforeMgrSelf, "manager actor skips create notify");
assert(createMsgs(admin).length === beforeAdmin2 + 1, "admin notified for manager create");
assert(
  data<any[]>(app.call("message.list", {}, agent)).filter(
    (m) => m.kind === "marketing" && m.title === "新营销线索已分配"
  ).length ===
    beforeAgentAssign + 1,
  "assignee still receives assignment message"
);

assert(
  app.call("message.subscriptions.save", { channels: { marketing: false } }, admin).ok,
  "mute marketing"
);
const beforeMute = createMsgs(admin).length;
const beforeMuteMgr = createMsgs(manager).length;
assert(
  app.call(
    "marketing.leads.create",
    {
      contact_name: "静音登记线索",
      contact_phone: "13991003333",
      intent: "buy",
      channel: "walk_in",
    },
    agent
  ).ok,
  "create while muted"
);
assert(createMsgs(admin).length === beforeMute, "muted marketing suppresses message");
assert(
  createMsgs(manager).length === beforeMuteMgr + 1,
  "manager still receives when admin muted"
);

console.log(`Lead create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
