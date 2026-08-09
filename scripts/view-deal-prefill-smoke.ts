import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "view-deal-prefill-smoke.db")).dbPath);
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

const agent = login("agent_a");
const agentB = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const house = app.call(
  "house.create",
  {
    title: "带看转成交盘",
    deal_type: "sale",
    community: "预填苑",
    price: 266,
    owner_name: "业主",
    owner_phone: "13680005001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const customer = app.call(
  "customer.create",
  {
    name: "意向客",
    phone: "13680005002",
    intent: "buy",
    level: "A",
  },
  agent
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const otherHouse = app.call(
  "house.create",
  {
    title: "另一套房",
    deal_type: "sale",
    community: "预填苑",
    price: 300,
    owner_name: "业主乙",
    owner_phone: "13680005003",
    status: "available",
  },
  agent
);
assert(otherHouse.ok, "create other house");
const otherHouseId = data<any>(otherHouse).id;

const planned = app.call(
  "view.create",
  {
    customer_id: customerId,
    house_id: houseId,
    view_at: new Date().toISOString(),
  },
  agent
);
assert(planned.ok, "create planned view");
const plannedId = data<any>(planned).id;

assert(
  !app.call(
    "deal.create",
    {
      house_id: houseId,
      customer_id: customerId,
      view_id: plannedId,
      contract_price: 266,
      commission_owner: 10000,
      commission_customer: 10000,
      agent_ids: [agentId],
      split_ratios: { [agentId]: 100 },
    },
    agent
  ).ok,
  "reject deal from planned view"
);

assert(
  app.call(
    "view.complete",
    { id: plannedId, feedback: "considering", content: "再看看" },
    agent
  ).ok,
  "complete as considering"
);
assert(
  !app.call(
    "deal.create",
    {
      house_id: houseId,
      customer_id: customerId,
      view_id: plannedId,
      contract_price: 266,
      commission_owner: 10000,
      commission_customer: 10000,
      agent_ids: [agentId],
      split_ratios: { [agentId]: 100 },
    },
    agent
  ).ok,
  "reject deal from considering view"
);

const interested = app.call(
  "view.create",
  {
    customer_id: customerId,
    house_id: houseId,
    view_at: new Date().toISOString(),
  },
  agent
);
assert(interested.ok, "create interested view");
const interestedId = data<any>(interested).id;
assert(
  app.call(
    "view.complete",
    { id: interestedId, feedback: "interested", content: "有意向" },
    agent
  ).ok,
  "complete as interested"
);

assert(
  !app.call(
    "deal.create",
    {
      house_id: otherHouseId,
      customer_id: customerId,
      view_id: interestedId,
      contract_price: 266,
      commission_owner: 10000,
      commission_customer: 10000,
      agent_ids: [agentId],
      split_ratios: { [agentId]: 100 },
    },
    agent
  ).ok,
  "reject mismatched house"
);

assert(
  !app.call(
    "deal.create",
    {
      house_id: houseId,
      customer_id: customerId,
      view_id: interestedId,
      contract_price: 266,
      commission_owner: 10000,
      commission_customer: 10000,
      agent_ids: [agentId],
      split_ratios: { [agentId]: 100 },
    },
    agentB
  ).ok,
  "reject other agent using view"
);

const created = app.call(
  "deal.create",
  {
    house_id: houseId,
    customer_id: customerId,
    view_id: interestedId,
    contract_price: 266,
    commission_owner: 10000,
    commission_customer: 10000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(created.ok, "create deal from interested view");
assert(data<any>(created).view_id === interestedId, "view_id persisted");
assert(data<any>(created).house_id === houseId, "house matched");
assert(data<any>(created).customer_id === customerId, "customer matched");

const dealFeedback = app.call(
  "view.create",
  {
    customer_id: customerId,
    house_id: otherHouseId,
    view_at: new Date().toISOString(),
  },
  agent
);
assert(dealFeedback.ok, "create deal-feedback view");
const dealViewId = data<any>(dealFeedback).id;
assert(
  app.call(
    "view.complete",
    { id: dealViewId, feedback: "deal", content: "当场意向" },
    agent
  ).ok,
  "complete as deal feedback"
);
const fromDealFeedback = app.call(
  "deal.create",
  {
    house_id: otherHouseId,
    customer_id: customerId,
    view_id: dealViewId,
    contract_price: 300,
    commission_owner: 12000,
    commission_customer: 8000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(fromDealFeedback.ok, "create deal from deal feedback view");

const noView = app.call(
  "deal.create",
  {
    house_id: otherHouseId,
    customer_id: customerId,
    contract_price: 301,
    commission_owner: 11000,
    commission_customer: 9000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(noView.ok, "create deal without view still allowed");

console.log(`View deal prefill smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
