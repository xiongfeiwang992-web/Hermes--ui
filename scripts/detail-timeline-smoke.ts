import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "detail-timeline-smoke.db")).dbPath);
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

const admin = login("admin");
const manager = login("manager");
const finance = login("finance");
const agent = login("agent_a");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

assert(!app.call("house.timeline", { id: "x" }, finance).ok, "finance cannot house timeline");
assert(!app.call("customer.timeline", { id: "x" }, finance).ok, "finance cannot customer timeline");

const house = app.call(
  "house.create",
  {
    title: "时间线房源",
    deal_type: "sale",
    community: "时间线苑",
    price: 260,
    owner_name: "业主",
    owner_phone: "13680004401",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const customer = app.call(
  "customer.create",
  { name: "时间线客", phone: "13680004402", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const followHouse = app.call(
  "follow.create",
  {
    target_type: "house",
    target_id: houseId,
    method: "phone",
    content: "已联系业主确认可看时间",
  },
  agent
);
assert(followHouse.ok, "create house follow");

const followCustomer = app.call(
  "follow.create",
  {
    target_type: "customer",
    target_id: customerId,
    method: "visit",
    content: "客户周末方便看房并比较两套",
  },
  agent
);
assert(followCustomer.ok, "create customer follow");

const view = app.call(
  "view.create",
  {
    customer_id: customerId,
    house_id: houseId,
    view_at: "2026-08-08T10:00:00.000Z",
  },
  agent
);
assert(view.ok, "create view");
const viewId = data<any>(view).id;
assert(
  app.call(
    "view.complete",
    { id: viewId, feedback: "interested", content: "客户有意向" },
    agent
  ).ok,
  "complete view"
);

const deal = app.call(
  "deal.create",
  {
    house_id: houseId,
    customer_id: customerId,
    contract_price: 260,
    commission_owner: 12000,
    commission_customer: 8000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;

const houseTl = app.call("house.timeline", { id: houseId }, manager);
assert(houseTl.ok, "manager house timeline");
const houseData = data<any>(houseTl);
assert(houseData.counts.follows >= 1, "house timeline has follow");
assert(houseData.counts.views >= 1, "house timeline has view");
assert(houseData.counts.deals >= 1, "house timeline has deal");
assert(
  houseData.items.some((item: any) => item.kind === "follow" && item.id === data<any>(followHouse).id),
  "house timeline includes follow item"
);
assert(
  houseData.items.some((item: any) => item.kind === "view" && item.id === viewId),
  "house timeline includes view item"
);
assert(
  houseData.items.some((item: any) => item.kind === "deal" && item.id === dealId),
  "house timeline includes deal item"
);
assert(
  houseData.items.every(
    (item: any, idx: number, arr: any[]) =>
      idx === 0 || String(arr[idx - 1].at) >= String(item.at)
  ),
  "house timeline sorted desc"
);

const customerTl = app.call("customer.timeline", { id: customerId }, agent);
assert(customerTl.ok, "agent customer timeline");
const customerData = data<any>(customerTl);
assert(customerData.counts.follows >= 1, "customer timeline has follow");
assert(customerData.counts.views >= 1, "customer timeline has view");
assert(customerData.counts.deals >= 1, "customer timeline has deal");
assert(
  customerData.items.some(
    (item: any) => item.kind === "follow" && item.id === data<any>(followCustomer).id
  ),
  "customer timeline includes customer follow"
);
assert(
  customerData.items.some((item: any) => item.kind === "view" && item.id === viewId),
  "customer timeline includes shared view"
);

assert(
  !app.call("house.timeline", { id: "missing-house" }, agent).ok,
  "missing house denied"
);
assert(
  !app.call("customer.timeline", { id: "missing-customer" }, agent).ok,
  "missing customer denied"
);

const emptyHouse = app.call(
  "house.create",
  {
    title: "空时间线房",
    deal_type: "rent",
    community: "空苑",
    price: 3000,
    price_unit: "yuan",
    owner_name: "业主乙",
    owner_phone: "13680004403",
    status: "available",
  },
  agent
);
assert(emptyHouse.ok, "create empty house");
const emptyTl = data<any>(app.call("house.timeline", { id: data<any>(emptyHouse).id }, admin));
assert(emptyTl.counts.total === 0 && emptyTl.items.length === 0, "empty timeline");

console.log(`Detail timeline smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
