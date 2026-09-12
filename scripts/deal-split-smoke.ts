import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "deal-split-smoke.db")).dbPath);
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

const agentA = login("agent_a");
const agentB = login("agent_b");
const manager = login("manager");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const house = app.call(
  "house.create",
  {
    title: "双人分成盘",
    deal_type: "sale",
    community: "分成苑",
    price: 360,
    owner_name: "业主",
    owner_phone: "13680011001",
    status: "available",
  },
  agentA
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "分成客", phone: "13680011002", intent: "buy" },
  agentA
);
assert(customer.ok, "create customer");

assert(
  !app.call(
    "deal.create",
    {
      house_id: data<any>(house).id,
      customer_id: data<any>(customer).id,
      contract_price: 360,
      commission_owner: 20000,
      commission_customer: 10000,
      agent_ids: [agentAId, agentBId],
      split_ratios: { [agentAId]: 60, [agentBId]: 30 },
    },
    agentA
  ).ok,
  "reject split not 100"
);

const created = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 360,
    commission_owner: 20000,
    commission_customer: 10000,
    agent_ids: [agentAId, agentBId],
    split_ratios: { [agentAId]: 60, [agentBId]: 40 },
  },
  agentA
);
assert(created.ok, "create 60/40 deal");
const dealId = data<any>(created).id;
assert(
  data<any>(created).agent_ids.includes(agentAId) &&
    data<any>(created).agent_ids.includes(agentBId),
  "agent_ids persisted"
);
assert(
  data<any>(created).split_ratios[agentAId] === 60 &&
    data<any>(created).split_ratios[agentBId] === 40,
  "split ratios persisted"
);
assert(
  Array.isArray(data<any>(created).agents) && data<any>(created).agents.length === 2,
  "agents presented"
);
assert(String(data<any>(created).split_summary || "").includes("%"), "split_summary present");

const listed = data<any[]>(app.call("deal.list", {}, manager)).find((row) => row.id === dealId);
assert(listed?.split_summary && listed.agents?.length === 2, "list shows split");

assert(
  !app.call(
    "deal.create",
    {
      house_id: data<any>(house).id,
      customer_id: data<any>(customer).id,
      contract_price: 360,
      commission_owner: 10000,
      commission_customer: 10000,
      agent_ids: [agentAId, "U_not_exist"],
      split_ratios: { [agentAId]: 50, U_not_exist: 50 },
    },
    agentA
  ).ok,
  "reject invalid agent"
);

assert(app.call("deal.submit", { id: dealId }, agentA).ok, "submit");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve");

const byUser = data<any[]>(app.call("commission.list", {}, manager)).filter(
  (row) => row.deal_id === dealId && [agentAId, agentBId].includes(row.user_id)
);
assert(byUser.length === 2, "two agent commission rows");
const rowA = byUser.find((row) => row.user_id === agentAId);
const rowB = byUser.find((row) => row.user_id === agentBId);
assert(rowA?.ratio === 60 && rowB?.ratio === 40, "commission ratios match split");
assert(Number(rowA?.amount) > Number(rowB?.amount), "60% amount greater than 40%");

const seenByB = data<any[]>(app.call("deal.list", {}, agentB)).some((row) => row.id === dealId);
assert(seenByB, "agent B can see shared deal");

const single = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 200,
    commission_owner: 8000,
    commission_customer: 7000,
  },
  agentA
);
assert(single.ok, "default single agent still works");
assert(
  data<any>(single).agent_ids.length === 1 &&
    data<any>(single).split_ratios[agentAId] === 100,
  "default 100% self"
);

console.log(`Deal split smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
