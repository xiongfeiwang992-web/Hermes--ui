import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "customer-to-public-notify-smoke.db")).dbPath
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
const toPublicMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "customer_to_public"
  );

const agentA = login("agent_a");
const manager = login("manager");
const admin = login("admin");

const created = app.call(
  "customer.create",
  { name: "转公提醒客", phone: "13680001001", intent: "buy" },
  agentA
);
assert(created.ok, "agent_a creates private customer");
const customerId = data<any>(created).id;

const beforeAgent = toPublicMsgs(agentA).length;
const beforeManager = toPublicMsgs(manager).length;

const turned = app.call(
  "customer.toPublic",
  { id: customerId, reason: "长期未跟进" },
  manager
);
assert(turned.ok, "manager turns agent private customer public");
assert(data<any>(turned).visibility === "public", "visibility becomes public");
assert(data<any>(turned).status === "public_pool", "status becomes public_pool");

const afterAgent = toPublicMsgs(agentA);
assert(afterAgent.length === beforeAgent + 1, "prior agent receives to-public message");
const msg = afterAgent[0];
assert(msg.title === "私客已转公客", "to-public message title");
assert(String(msg.body).includes("转公提醒客"), "body includes customer name");
assert(String(msg.body).includes("一号店长"), "body includes actor name");
assert(String(msg.body).includes("长期未跟进"), "body includes reason");
assert(msg.ref_id === customerId, "message refs customer");
assert(toPublicMsgs(manager).length === beforeManager, "actor does not self-notify");

const created2 = app.call(
  "customer.create",
  { name: "自转公客", phone: "13680001002", intent: "rent" },
  agentA
);
assert(created2.ok, "create second customer");
const id2 = data<any>(created2).id;
const beforeSelf = toPublicMsgs(agentA).length;
assert(
  app.call("customer.toPublic", { id: id2, reason: "本人转公" }, agentA).ok,
  "agent turns own customer public"
);
assert(toPublicMsgs(agentA).length === beforeSelf, "self toPublic skips notify");

assert(
  !app.call("customer.toPublic", { id: id2, reason: "重复" }, agentA).ok,
  "reject already-public customer"
);

const created3 = app.call(
  "customer.create",
  { name: "转公静音客", phone: "13680001003", intent: "buy" },
  agentA
);
assert(created3.ok, "create mute-test customer");
const id3 = data<any>(created3).id;
assert(
  app.call("message.subscriptions.save", { channels: { customer: false } }, agentA).ok,
  "mute customer channel"
);
const beforeMute = toPublicMsgs(agentA).length;
assert(
  app.call("customer.toPublic", { id: id3, reason: "静音测" }, manager).ok,
  "manager toPublic while muted"
);
assert(toPublicMsgs(agentA).length === beforeMute, "muted channel suppresses to-public message");

const channels = data<any>(app.call("message.subscriptions.get", {}, admin)).channels;
const customerChannel = channels.find((c: any) => c.key === "customer");
assert(customerChannel?.label === "客源提醒", "customer channel label updated");
assert(
  String(customerChannel?.description || "").includes("转公"),
  "customer channel description mentions to-public"
);

console.log(`Customer to-public notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
