import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "online-entrust-reject-notify-smoke.db")).dbPath
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
const rejectMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "marketing" && m.title === "在线委托已驳回"
  );

const agentA = login("agent_a");
const manager = login("manager");
const admin = login("admin");

const created = app.call(
  "marketing.entrustments.create",
  {
    entrust_type: "sell",
    contact_name: "驳回通知业主",
    contact_phone: "13990001001",
    content: "希望尽快出售",
    community: "驳回花园",
  },
  agentA
);
assert(created.ok, "agent creates online entrustment");
const entrustmentId = data<any>(created).id;

const beforeAgent = rejectMsgs(agentA).length;
const beforeManager = rejectMsgs(manager).length;

assert(
  !app.call(
    "marketing.entrustments.reject",
    { id: entrustmentId, reason: "" },
    manager
  ).ok,
  "reject requires reason"
);

const rejected = app.call(
  "marketing.entrustments.reject",
  { id: entrustmentId, reason: "联系方式无效" },
  manager
);
assert(rejected.ok, "manager rejects entrustment");
assert(data<any>(rejected).status === "rejected", "status rejected");
assert(data<any>(rejected).reject_reason === "联系方式无效", "reject_reason returned");

const afterAgent = rejectMsgs(agentA);
assert(afterAgent.length === beforeAgent + 1, "creator receives reject message");
assert(afterAgent[0].ref_id === entrustmentId, "message refs entrustment");
assert(String(afterAgent[0].body).includes("驳回通知业主"), "body has contact name");
assert(String(afterAgent[0].body).includes("一号店长"), "body has actor name");
assert(String(afterAgent[0].body).includes("联系方式无效"), "body has reason");
assert(rejectMsgs(manager).length === beforeManager, "rejector does not self-notify");

assert(
  !app.call(
    "marketing.entrustments.reject",
    { id: entrustmentId, reason: "再次驳回" },
    manager
  ).ok,
  "cannot reject twice"
);

const created2 = app.call(
  "marketing.entrustments.create",
  {
    entrust_type: "rent",
    contact_name: "静音驳回客",
    contact_phone: "13990001002",
    content: "求租一居",
  },
  agentA
);
assert(created2.ok, "create mute-test entrustment");
const id2 = data<any>(created2).id;
assert(
  app.call("message.subscriptions.save", { channels: { marketing: false } }, agentA).ok,
  "mute marketing channel"
);
const beforeMute = rejectMsgs(agentA).length;
assert(
  app.call(
    "marketing.entrustments.reject",
    { id: id2, reason: "信息不全" },
    manager
  ).ok,
  "reject while muted"
);
assert(rejectMsgs(agentA).length === beforeMute, "muted marketing suppresses reject message");

const self = app.call(
  "marketing.entrustments.create",
  {
    entrust_type: "buy",
    contact_name: "店长自登委托",
    contact_phone: "13990001003",
    content: "自测",
  },
  manager
);
assert(self.ok, "manager creates entrustment");
const beforeSelf = rejectMsgs(manager).length;
assert(
  app.call(
    "marketing.entrustments.reject",
    { id: data<any>(self).id, reason: "自测驳回" },
    manager
  ).ok,
  "manager rejects own entrustment"
);
assert(rejectMsgs(manager).length === beforeSelf, "self reject skips notify");

assert(
  data<any[]>(app.call("message.list", {}, admin)).every(
    (m) => !(m.ref_id === entrustmentId && m.title === "在线委托已驳回")
  ),
  "admin inbox not targeted for store reject"
);

console.log(`Online entrust reject notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
