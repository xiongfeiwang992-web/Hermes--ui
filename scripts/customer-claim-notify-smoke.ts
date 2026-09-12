import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "customer-claim-notify-smoke.db")).dbPath);
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
const claimMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter((m) => m.kind === "customer_claim");

const agentA = login("agent_a");
const agentB = login("agent_b");
const admin = login("admin");

const created = app.call(
  "customer.create",
  { name: "认领提醒客", phone: "13670001001", intent: "buy" },
  agentA
);
assert(created.ok, "agent_a creates private customer");
const customerId = data<any>(created).id;
const agentAId = data<any>(created).agent_id;

assert(
  app.call("customer.toPublic", { id: customerId, reason: "暂无跟进" }, agentA).ok,
  "agent_a turns customer public"
);

const beforeA = claimMsgs(agentA).length;
const beforeB = claimMsgs(agentB).length;

const claimed = app.call("customer.claim", { id: customerId }, agentB);
assert(claimed.ok, "agent_b claims public customer");
assert(data<any>(claimed).visibility === "private", "claimed becomes private");
assert(data<any>(claimed).agent_id !== agentAId, "agent switches to claimer");

const afterA = claimMsgs(agentA);
assert(afterA.length === beforeA + 1, "prior agent receives claim message");
const msg = afterA[0];
assert(msg.title === "公客已被认领", "claim message title");
assert(String(msg.body).includes("认领提醒客"), "claim message body has customer name");
assert(String(msg.body).includes("经纪人乙"), "claim message body has claimer name");
assert(msg.ref_id === customerId, "claim message refs customer");
assert(claimMsgs(agentB).length === beforeB, "claimer does not self-notify");

const created2 = app.call(
  "customer.create",
  { name: "自认领客", phone: "13670001002", intent: "rent" },
  agentA
);
assert(created2.ok, "create second customer");
const id2 = data<any>(created2).id;
assert(app.call("customer.toPublic", { id: id2, reason: "自测" }, agentA).ok, "self toPublic");
const beforeSelf = claimMsgs(agentA).length;
assert(app.call("customer.claim", { id: id2 }, agentA).ok, "original agent reclaims");
assert(claimMsgs(agentA).length === beforeSelf, "self reclaim skips notify");

const created3 = app.call(
  "customer.create",
  { name: "订阅静音客", phone: "13670001003", intent: "buy" },
  agentA
);
assert(created3.ok, "create mute-test customer");
const id3 = data<any>(created3).id;
assert(app.call("customer.toPublic", { id: id3, reason: "静音测" }, agentA).ok, "toPublic mute case");
assert(
  app.call("message.subscriptions.save", { channels: { customer: false } }, agentA).ok,
  "mute customer channel for prior agent"
);
const beforeMute = claimMsgs(agentA).length;
assert(app.call("customer.claim", { id: id3 }, agentB).ok, "claim while muted");
assert(claimMsgs(agentA).length === beforeMute, "muted channel suppresses claim message");

assert(
  !app.call("customer.claim", { id: customerId }, agentA).ok,
  "cannot claim already-private customer"
);

const channels = data<any>(app.call("message.subscriptions.get", {}, admin)).channels;
const customerChannel = channels.find((c: any) => c.key === "customer");
assert(customerChannel?.label === "客源提醒", "customer channel label updated");
assert(
  String(customerChannel?.description || "").includes("认领"),
  "customer channel description mentions claim"
);

console.log(`Customer claim notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
