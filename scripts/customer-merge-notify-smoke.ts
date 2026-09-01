import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "customer-merge-notify-smoke.db")).dbPath
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
const mergeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "customer_merge" && m.title === "客源已合并"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const source = app.call(
  "customer.create",
  { name: "合并源客", phone: "13644001111", intent: "buy", need: "合并源客源" },
  agent
);
assert(source.ok, "create source customer");
const sourceId = data<any>(source).id;

const target = app.call(
  "customer.create",
  { name: "合并目标客", phone: "13644002222", intent: "buy", need: "合并目标客源" },
  peer
);
assert(target.ok, "create target customer");
const targetId = data<any>(target).id;

const beforeAgent = mergeMsgs(agent).length;
const beforePeer = mergeMsgs(peer).length;
const beforeManager = mergeMsgs(manager).length;
const merged = app.call(
  "customer.merge",
  { source_id: sourceId, target_id: targetId, reason: "重复客源合并" },
  manager
);
assert(merged.ok, "manager merges customers");
assert(mergeMsgs(agent).length === beforeAgent + 1, "source agent receives merge message");
assert(mergeMsgs(peer).length === beforePeer + 1, "target agent receives merge message");
assert(mergeMsgs(manager).length === beforeManager, "merger does not self-notify");
assert(
  mergeMsgs(agent).some(
    (m) =>
      m.ref_id === targetId &&
      String(m.body).includes("合并源客") &&
      String(m.body).includes("合并目标客")
  ),
  "merge message body"
);

const selfA = app.call(
  "customer.create",
  { name: "自合并甲", phone: "13644003333", intent: "rent", need: "自合并甲客" },
  agent
);
const selfB = app.call(
  "customer.create",
  { name: "自合并乙", phone: "13644004444", intent: "rent", need: "自合并乙客" },
  agent
);
assert(selfA.ok && selfB.ok, "agent creates two customers");
assert(
  !app.call(
    "customer.merge",
    {
      source_id: data<any>(selfA).id,
      target_id: data<any>(selfB).id,
      reason: "本人客源合并",
    },
    agent
  ).ok,
  "agent cannot merge"
);

const a1 = app.call(
  "customer.create",
  { name: "同经纪人源", phone: "13644005555", intent: "buy", need: "同经纪人源客" },
  agent
);
const a2 = app.call(
  "customer.create",
  { name: "同经纪人目标", phone: "13644006666", intent: "buy", need: "同经纪人目标客" },
  agent
);
assert(a1.ok && a2.ok, "agent creates pair");
const beforePair = mergeMsgs(agent).length;
assert(
  app.call(
    "customer.merge",
    {
      source_id: data<any>(a1).id,
      target_id: data<any>(a2).id,
      reason: "同经纪人合并",
    },
    manager
  ).ok,
  "merge same-agent customers"
);
assert(mergeMsgs(agent).length === beforePair + 1, "same agent gets single merge message");

assert(
  app.call("message.subscriptions.save", { channels: { customer: false } }, agent).ok,
  "mute customer"
);
const m1 = app.call(
  "customer.create",
  { name: "静音源客", phone: "13644007777", intent: "buy", need: "静音源客源" },
  agent
);
const m2 = app.call(
  "customer.create",
  { name: "静音目标客", phone: "13644008888", intent: "buy", need: "静音目标客源" },
  peer
);
assert(m1.ok && m2.ok, "create muted pair");
const beforeMute = mergeMsgs(agent).length;
const beforeMutePeer = mergeMsgs(peer).length;
assert(
  app.call(
    "customer.merge",
    {
      source_id: data<any>(m1).id,
      target_id: data<any>(m2).id,
      reason: "静音合并",
    },
    manager
  ).ok,
  "merge while muted"
);
assert(mergeMsgs(agent).length === beforeMute, "muted customer suppresses message");
assert(mergeMsgs(peer).length === beforeMutePeer + 1, "unmuted peer still receives");

console.log(`Customer merge notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
