import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "transfer-node-complete-notify-smoke.db")).dbPath
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
const completeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "transfer_node" && m.title === "过户节点已完成"
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
      community: "过户完成小区",
      price: 280,
      owner_name: "过户完成业主",
      owner_phone: `1378${phoneSuffix}`,
      status: "available",
    },
    agentA
  );
  assert(house.ok, `create house ${title}`);
  const customer = app.call(
    "customer.create",
    { name: `过户完成客户${phoneSuffix}`, phone: `1388${phoneSuffix}`, intent: "buy" },
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

const dealId = createApprovedDeal("过户节点完成房", "0000401");
const node = app.call(
  "transfer.create",
  {
    deal_id: dealId,
    node_type: "tax",
    title: "缴纳契税完成节点",
    planned_at: "2026-09-15T10:00:00.000Z",
    assignee_user_id: agentBId,
  },
  manager
);
assert(node.ok, "manager creates assigned transfer node");
const nodeId = data<any>(node).id;

const beforeAssignee = completeMsgs(agentB).length;
const beforeCreator = completeMsgs(agentA).length;
const beforeManager = completeMsgs(manager).length;
const completed = app.call(
  "transfer.status",
  { id: nodeId, status: "completed" },
  manager
);
assert(completed.ok, "manager completes transfer node");
assert(data<any>(completed).status === "completed", "status completed");

assert(
  completeMsgs(agentB).length === beforeAssignee + 1,
  "assignee receives complete message"
);
assert(
  completeMsgs(agentA).length === beforeCreator + 1,
  "deal creator receives complete message"
);
assert(completeMsgs(manager).length === beforeManager, "completer does not self-notify");
assert(
  completeMsgs(agentB).some(
    (m) =>
      m.ref_id === dealId &&
      m.ref_type === "deal" &&
      String(m.body).includes("缴纳契税完成节点") &&
      String(m.body).includes(dealId)
  ),
  "complete message body"
);

assert(
  !app.call("transfer.status", { id: nodeId, status: "completed" }, manager).ok,
  "cannot complete twice"
);

const dealId2 = createApprovedDeal("静音过户完成房", "0000402");
const node2 = app.call(
  "transfer.create",
  {
    deal_id: dealId2,
    node_type: "registration",
    title: "产权过户完成节点",
    assignee_user_id: agentBId,
  },
  manager
);
assert(node2.ok, "create mute-test transfer node");
assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agentB).ok,
  "mute house channel"
);
const beforeMute = completeMsgs(agentB).length;
assert(
  app.call(
    "transfer.status",
    { id: data<any>(node2).id, status: "completed" },
    manager
  ).ok,
  "complete while muted"
);
assert(completeMsgs(agentB).length === beforeMute, "muted house suppresses complete message");

console.log(
  `Transfer node complete notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
