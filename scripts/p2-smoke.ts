import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const dbPath = path.resolve("data", "p2-smoke.db");
seedDatabase(dbPath);
const app = createApp(dbPath);

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error("FAIL:", message);
  }
}

function dataOf<T = any>(result: any): T {
  return result.data as T;
}

function login(account: string): string {
  const result = app.call("auth.login", { account, password: "123456" });
  assert(result.ok, `${account} login`);
  return result.ok ? dataOf<any>(result).token : "";
}

const agent = login("agent_a");
const manager = login("manager");
const finance = login("finance");

const community = app.call(
  "property.communities.upsert",
  {
    name: "湖畔花园",
    district: "滨湖区",
    address: "湖畔路 8 号",
    building_count: 12,
  },
  agent
);
assert(community.ok, "create community");
const communities = app.call("property.communities.list", { keyword: "湖畔" }, agent);
assert(
  communities.ok && dataOf<any[]>(communities).some((item) => item.name === "湖畔花园"),
  "list community"
);

const house = app.call(
  "house.create",
  {
    title: "湖畔花园精装两室",
    deal_type: "sale",
    community: "湖畔花园",
    district: "滨湖区",
    price: 210,
    owner_name: "王业主",
    owner_phone: "13600001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create P2 house");
const houseId = dataOf<any>(house).id;

const customer = app.call(
  "customer.create",
  {
    name: "赵客户",
    phone: "13500002222",
    intent: "buy",
    budget_min: 180,
    budget_max: 230,
    level: "A",
  },
  agent
);
assert(customer.ok, "create P2 customer");
const customerId = dataOf<any>(customer).id;

const matches = app.call("customer.matchHouses", { id: customerId }, agent);
assert(
  matches.ok && dataOf<any[]>(matches).some((item) => item.id === houseId),
  "customer matches available house within budget"
);

const key = app.call(
  "property.keys.register",
  { house_id: houseId, key_no: "K-001" },
  agent
);
assert(key.ok, "register key");
const keyId = dataOf<any>(key).id;
assert(
  app.call(
    "property.keys.borrow",
    {
      id: keyId,
      expected_return_at: new Date(Date.now() + 86400000).toISOString(),
    },
    agent
  ).ok,
  "borrow key"
);
const borrowed = app.call("property.keys.list", { status: "borrowed" }, agent);
assert(
  borrowed.ok && dataOf<any[]>(borrowed).some((item) => item.id === keyId),
  "borrowed key listed"
);
assert(app.call("property.keys.return", { id: keyId }, agent).ok, "return key");

const survey = app.call(
  "property.surveys.create",
  {
    house_id: houseId,
    survey_type: "survey",
    summary: "采光良好，装修保持完整",
  },
  agent
);
assert(survey.ok, "create house survey");

const verification = app.call(
  "property.verifications.submit",
  {
    house_id: houseId,
    contact_result: "业主确认在售",
    price_confirmed: 210,
    availability_confirmed: true,
  },
  agent
);
assert(verification.ok, "submit verification");
const verificationId = dataOf<any>(verification).id;
assert(
  app.call(
    "property.verifications.review",
    { id: verificationId, status: "approved" },
    manager
  ).ok,
  "manager approves verification"
);

const earnest = app.call(
  "earnest.create",
  {
    customer_id: customerId,
    house_id: houseId,
    amount: 10000,
    method: "transfer",
  },
  agent
);
assert(earnest.ok, "create earnest money");
const earnestId = dataOf<any>(earnest).id;

const agentMe = app.call("auth.me", {}, agent);
const agentId = dataOf<any>(agentMe).id;
const deal = app.call(
  "deal.create",
  {
    house_id: houseId,
    customer_id: customerId,
    contract_price: 205,
    commission_owner: 12000,
    commission_customer: 10000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal for earnest apply");
const dealId = dataOf<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit P2 deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve P2 deal");
assert(
  app.call("earnest.apply", { id: earnestId, deal_id: dealId }, finance).ok,
  "apply earnest to approved deal"
);
const applied = app.call("earnest.list", { status: "applied" }, finance);
assert(
  applied.ok && dataOf<any[]>(applied).some((item) => item.id === earnestId),
  "applied earnest listed"
);
const dealDetail = app.call("deal.get", { id: dealId }, finance);
assert(
  dealDetail.ok && dataOf<any>(dealDetail).paid_amount === 10000,
  "earnest application creates payment"
);

console.log(`P2 smoke result: passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
