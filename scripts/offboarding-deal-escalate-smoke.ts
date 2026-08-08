import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "offboarding-deal-escalate-smoke.db")).dbPath);
let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const managerId = data<any>(app.call("auth.me", {}, manager)).id;
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const house = app.call(
  "house.create",
  {
    title: "离职成交转上级房源",
    deal_type: "sale",
    community: "成交交接小区",
    price: 220,
    owner_name: "成交交接业主",
    owner_phone: "13730000001",
    status: "available",
  },
  agentA
);
check(house.ok, "create house for pending deals");
const houseId = data<any>(house).id;
const customer = app.call(
  "customer.create",
  { name: "离职成交客户", phone: "13830000001", intent: "buy" },
  agentA
);
check(customer.ok, "create customer for pending deals");
const customerId = data<any>(customer).id;

const draftDeal = app.call(
  "deal.create",
  {
    house_id: houseId,
    customer_id: customerId,
    contract_price: 210,
    commission_owner: 12000,
    commission_customer: 8000,
    agent_ids: [agentAId],
    split_ratios: { [agentAId]: 100 },
  },
  agentA
);
check(draftDeal.ok, "create draft deal owned by leaving agent");
const draftDealId = data<any>(draftDeal).id;

const pendingDeal = app.call(
  "deal.create",
  {
    house_id: houseId,
    customer_id: customerId,
    contract_price: 215,
    commission_owner: 11000,
    commission_customer: 9000,
    agent_ids: [agentAId, agentBId],
    split_ratios: { [agentAId]: 60, [agentBId]: 40 },
  },
  agentA
);
check(pendingDeal.ok, "create second deal with co-agent");
const pendingDealId = data<any>(pendingDeal).id;
check(app.call("deal.submit", { id: pendingDealId }, agentA).ok, "submit deal pending approval");

const preview = app.call("offboarding.preview", { user_id: agentAId }, manager);
check(
  preview.ok &&
    Array.isArray(data<any>(preview).deals) &&
    data<any>(preview).deals.length === 2 &&
    data<any>(preview).deals.every((deal: any) =>
      [draftDealId, pendingDealId].includes(deal.id)
    ),
  "preview includes pending deals for leaving agent"
);

const task = app.call(
  "offboarding.start",
  {
    user_id: agentAId,
    target_user_id: agentBId,
    reason: "离职待办成交转上级",
  },
  manager
);
check(task.ok, "start offboarding with pending deals");
const taskId = data<any>(task).id;
check(
  data<any>(task).snapshot?.deals?.length === 2,
  "start snapshot includes pending deal count"
);

const managerMessagesAfterStart = data<any[]>(app.call("message.list", {}, manager));
check(
  managerMessagesAfterStart.some(
    (message) =>
      message.kind === "offboarding_deal" &&
      message.ref_id === taskId &&
      String(message.title).includes("待办成交")
  ),
  "store manager notified on offboarding start for pending deals"
);

const executed = app.call("offboarding.execute", { id: taskId }, manager);
check(
  executed.ok &&
    data<any>(executed).houses >= 1 &&
    data<any>(executed).customers >= 1 &&
    data<any>(executed).deals === 2,
  "execute returns transferred pending deal count"
);

const draftAfter = data<any>(app.call("deal.get", { id: draftDealId }, agentB));
check(
  draftAfter.created_by === agentBId &&
    (draftAfter.agent_ids as string[]).includes(agentBId) &&
    !(draftAfter.agent_ids as string[]).includes(agentAId) &&
    Number((draftAfter.split_ratios as Record<string, number>)[agentBId]) === 100,
  "draft deal reassigned to receiver with merged split"
);

const pendingAfter = data<any>(app.call("deal.get", { id: pendingDealId }, agentB));
const pendingAgents = pendingAfter.agent_ids as string[];
const pendingSplits = pendingAfter.split_ratios as Record<string, number>;
check(
  pendingAfter.created_by === agentBId &&
    pendingAgents.includes(agentBId) &&
    !pendingAgents.includes(agentAId) &&
    Number(pendingSplits[agentBId]) === 100 &&
    pendingSplits[agentAId] == null,
  "pending deal replaces leaving agent and merges commission split"
);

const managerMessagesAfterExecute = data<any[]>(app.call("message.list", {}, manager));
check(
  managerMessagesAfterExecute.some(
    (message) =>
      message.kind === "offboarding_deal" &&
      message.ref_id === taskId &&
      String(message.title).includes("已转交") &&
      String(message.body).includes("转给")
  ),
  "store manager notified after pending deals transferred"
);

check(
  data<any[]>(app.call("message.list", {}, agentB)).some(
    (message) => message.kind === "offboarding" && message.ref_id === taskId
  ),
  "receiver still gets standard offboarding messages"
);

check(managerId && !app.call("auth.me", {}, agentA).ok, "leaving agent deactivated after execute");

console.log(`Offboarding deal escalate smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
