import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "mortgage-update-notify-smoke.db")).dbPath
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
const updateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "mortgage_status" && m.title === "按揭记录已更新"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

const house = app.call(
  "house.create",
  {
    title: "按揭更新通知房",
    deal_type: "sale",
    community: "按揭更新苑",
    price: 300,
    owner_name: "按揭业主",
    owner_phone: "13771001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "按揭更新客", phone: "13871001111", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 280,
    commission_owner: 8000,
    commission_customer: 8000,
    agent_ids: [agentId, peerId],
    split_ratios: { [agentId]: 50, [peerId]: 50 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;

assert(
  app.call(
    "mortgage.upsert",
    { deal_id: dealId, bank: "更新测试银行", amount: 160, remark: "首套" },
    manager
  ).ok,
  "manager creates mortgage"
);

const beforeAgent = updateMsgs(agent).length;
const beforePeer = updateMsgs(peer).length;
const beforeManager = updateMsgs(manager).length;
const updated = app.call(
  "mortgage.upsert",
  { deal_id: dealId, bank: "更新测试银行改", amount: 155, remark: "调整" },
  manager
);
assert(updated.ok, "manager updates mortgage");
assert(updateMsgs(agent).length === beforeAgent + 1, "deal agent receives update message");
assert(updateMsgs(peer).length === beforePeer + 1, "peer agent receives update message");
assert(updateMsgs(manager).length === beforeManager, "updater does not self-notify");
assert(
  updateMsgs(agent).some(
    (m) =>
      m.ref_id === dealId &&
      m.ref_type === "deal" &&
      String(m.body).includes("更新测试银行改") &&
      String(m.body).includes("155")
  ),
  "update message body"
);

const beforeSelfAgent = updateMsgs(agent).length;
const beforeSelfPeer = updateMsgs(peer).length;
assert(
  app.call(
    "mortgage.upsert",
    { deal_id: dealId, bank: "经纪人改按揭", amount: 150 },
    agent
  ).ok,
  "agent updates mortgage"
);
assert(updateMsgs(agent).length === beforeSelfAgent, "agent actor skips self");
assert(updateMsgs(peer).length === beforeSelfPeer + 1, "peer notified on agent update");

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agent).ok,
  "mute house"
);
const beforeMute = updateMsgs(agent).length;
const beforeMutePeer = updateMsgs(peer).length;
assert(
  app.call(
    "mortgage.upsert",
    { deal_id: dealId, bank: "静音更新银行", amount: 140 },
    manager
  ).ok,
  "update while muted"
);
assert(updateMsgs(agent).length === beforeMute, "muted house suppresses message");
assert(updateMsgs(peer).length === beforeMutePeer + 1, "peer still receives when agent muted");

console.log(`Mortgage update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
