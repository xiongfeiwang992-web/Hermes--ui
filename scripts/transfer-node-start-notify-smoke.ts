import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "transfer-node-start-notify-smoke.db")).dbPath
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
const startMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "transfer_node" && m.title === "过户节点已开始"
  );

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

function createApprovedDeal(title: string, phoneSuffix: string) {
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "过户开始小区",
      price: 280,
      owner_name: "过户开始业主",
      owner_phone: `1377${phoneSuffix}`,
      status: "available",
    },
    agentA
  );
  assert(house.ok, `create house ${title}`);
  const customer = app.call(
    "customer.create",
    { name: `过户开始客户${phoneSuffix}`, phone: `1387${phoneSuffix}`, intent: "buy" },
    agentA
  );
  assert(customer.ok, `create customer ${phoneSuffix}`);
  const deal = app.call(
    "deal.create",
    {
      house_id: data<any>(house).id,
      customer_id: data<any>(customer).id,
      contract_price: 260,
      commission_owner: 9000,
      commission_customer: 9000,
      agent_ids: [agentAId],
      split_ratios: { [agentAId]: 100 },
    },
    agentA
  );
  assert(deal.ok, `create deal ${title}`);
  const dealId = data<any>(deal).id;
  assert(app.call("deal.submit", { id: dealId }, agentA).ok, `submit ${title}`);
  assert(app.call("deal.approve", { id: dealId }, manager).ok, `approve ${title}`);
  return dealId;
}

const dealId = createApprovedDeal("过户节点开始房", "0000501");
const node = app.call(
  "transfer.create",
  {
    deal_id: dealId,
    node_type: "tax",
    title: "缴纳契税开始节点",
    planned_at: "2026-09-15T10:00:00.000Z",
    assignee_user_id: agentBId,
  },
  manager
);
assert(node.ok, "manager creates assigned transfer node");
const nodeId = data<any>(node).id;

const beforeAssignee = startMsgs(agentB).length;
const beforeCreator = startMsgs(agentA).length;
const beforeManager = startMsgs(manager).length;
const started = app.call(
  "transfer.status",
  { id: nodeId, status: "in_progress" },
  manager
);
assert(started.ok, "manager starts transfer node");
assert(data<any>(started).status === "in_progress", "status in_progress");

assert(
  startMsgs(agentB).length === beforeAssignee + 1,
  "assignee receives start message"
);
assert(
  startMsgs(agentA).length === beforeCreator + 1,
  "deal creator receives start message"
);
assert(startMsgs(manager).length === beforeManager, "starter does not self-notify");
assert(
  startMsgs(agentB).some(
    (m) =>
      m.ref_id === dealId &&
      m.ref_type === "deal" &&
      String(m.body).includes("缴纳契税开始节点") &&
      String(m.body).includes(dealId)
  ),
  "start message body"
);

assert(
  !app.call("transfer.status", { id: nodeId, status: "in_progress" }, manager).ok,
  "cannot start twice"
);

const dealId2 = createApprovedDeal("静音过户开始房", "0000502");
const node2 = app.call(
  "transfer.create",
  {
    deal_id: dealId2,
    node_type: "registration",
    title: "产权过户开始节点",
    assignee_user_id: agentBId,
  },
  manager
);
assert(node2.ok, "create mute-test transfer node");
assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agentB).ok,
  "mute house channel"
);
const beforeMute = startMsgs(agentB).length;
assert(
  app.call(
    "transfer.status",
    { id: data<any>(node2).id, status: "in_progress" },
    manager
  ).ok,
  "start while muted"
);
assert(startMsgs(agentB).length === beforeMute, "muted house suppresses start message");

console.log(
  `Transfer node start notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
