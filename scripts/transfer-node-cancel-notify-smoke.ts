import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "transfer-node-cancel-notify-smoke.db")).dbPath
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
const cancelMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "transfer_node" && m.title === "过户节点已取消"
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
      community: "过户取消小区",
      price: 280,
      owner_name: "过户取消业主",
      owner_phone: `1379${phoneSuffix}`,
      status: "available",
    },
    agentA
  );
  assert(house.ok, `create house ${title}`);
  const customer = app.call(
    "customer.create",
    { name: `过户客户${phoneSuffix}`, phone: `1389${phoneSuffix}`, intent: "buy" },
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

const dealId = createApprovedDeal("过户节点取消房", "0000301");
const node = app.call(
  "transfer.create",
  {
    deal_id: dealId,
    node_type: "tax",
    title: "缴纳契税节点",
    planned_at: "2026-09-15T10:00:00.000Z",
    assignee_user_id: agentBId,
  },
  manager
);
assert(node.ok, "manager creates assigned transfer node");
const nodeId = data<any>(node).id;

assert(
  data<any[]>(app.call("message.list", {}, agentB)).some(
    (m) => m.ref_id === dealId && m.title === "新增交易办理节点"
  ),
  "assignee received create message"
);

assert(
  !app.call("transfer.status", { id: nodeId, status: "cancelled", reason: "" }, manager)
    .ok,
  "cancel requires reason"
);

const beforeAssignee = cancelMsgs(agentB).length;
const beforeCreator = cancelMsgs(agentA).length;
const beforeManager = cancelMsgs(manager).length;
const cancelled = app.call(
  "transfer.status",
  { id: nodeId, status: "cancelled", reason: "客户暂缓缴税" },
  manager
);
assert(cancelled.ok, "manager cancels transfer node");
assert(data<any>(cancelled).status === "cancelled", "status cancelled");

const afterAssignee = cancelMsgs(agentB);
assert(afterAssignee.length === beforeAssignee + 1, "assignee receives cancel message");
assert(afterAssignee[0].ref_id === dealId, "message refs deal");
assert(String(afterAssignee[0].body).includes("缴纳契税节点"), "body has node title");
assert(String(afterAssignee[0].body).includes("客户暂缓缴税"), "body has reason");
assert(
  cancelMsgs(agentA).length === beforeCreator + 1,
  "deal creator receives cancel message"
);
assert(cancelMsgs(manager).length === beforeManager, "canceller does not self-notify");
assert(
  !app.call(
    "transfer.status",
    { id: nodeId, status: "cancelled", reason: "再次取消" },
    manager
  ).ok,
  "cannot cancel twice"
);

const dealId2 = createApprovedDeal("静音过户取消房", "0000302");
const node2 = app.call(
  "transfer.create",
  {
    deal_id: dealId2,
    node_type: "registration",
    title: "产权过户节点",
    assignee_user_id: agentBId,
  },
  manager
);
assert(node2.ok, "create mute-test transfer node");
assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agentB).ok,
  "mute house channel"
);
const beforeMute = cancelMsgs(agentB).length;
assert(
  app.call(
    "transfer.status",
    {
      id: data<any>(node2).id,
      status: "cancelled",
      reason: "静音场景取消",
    },
    manager
  ).ok,
  "cancel while assignee muted"
);
assert(cancelMsgs(agentB).length === beforeMute, "muted house suppresses cancel message");

console.log(
  `Transfer node cancel notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
