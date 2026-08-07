import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const dbPath = path.resolve("data", "p2b-smoke.db");
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

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const agentMe = dataOf<any>(app.call("auth.me", {}, agent));

function createCustomer(name: string, phone: string) {
  const result = app.call(
    "customer.create",
    { name, phone, intent: "buy", budget_min: 100, budget_max: 300, level: "B" },
    agent
  );
  assert(result.ok, `create customer ${name}`);
  return dataOf<any>(result).id as string;
}

const sourceCustomerId = createCustomer("待合并客户", "13511110001");
const targetCustomerId = createCustomer("保留客户", "13511110002");

const contact = app.call(
  "customer.contacts.upsert",
  {
    customer_id: sourceCustomerId,
    name: "客户配偶",
    phone: "13511110003",
    relation: "配偶",
    is_primary: true,
  },
  agent
);
assert(contact.ok, "add customer contact");
const contacts = app.call(
  "customer.contacts.list",
  { customer_id: sourceCustomerId },
  agent
);
assert(
  contacts.ok && dataOf<any[]>(contacts).some((item) => item.name === "客户配偶"),
  "list customer contacts"
);

assert(
  app.call(
    "follow.create",
    {
      target_type: "customer",
      target_id: sourceCustomerId,
      content: "合并前跟进记录",
      method: "call",
    },
    agent
  ).ok,
  "create source customer follow"
);

const merged = app.call(
  "customer.merge",
  {
    source_id: sourceCustomerId,
    target_id: targetCustomerId,
    reason: "重复录入",
  },
  manager
);
assert(merged.ok, "merge duplicate customers");
const customerList = app.call("customer.list", {}, manager);
assert(
  customerList.ok &&
    !dataOf<any[]>(customerList).some((item) => item.id === sourceCustomerId),
  "merged source hidden from active list"
);
const movedFollows = app.call(
  "follow.list",
  { target_type: "customer", target_id: targetCustomerId },
  manager
);
assert(
  movedFollows.ok && dataOf<any[]>(movedFollows).length === 1,
  "merge moves follows to target"
);
const movedContacts = app.call(
  "customer.contacts.list",
  { customer_id: targetCustomerId },
  manager
);
assert(
  movedContacts.ok && dataOf<any[]>(movedContacts).some((item) => item.name === "客户配偶"),
  "merge moves contacts to target"
);

const defaultPool = app.call("customer.publicPool.settings", {}, admin);
assert(
  defaultPool.ok && dataOf<any>(defaultPool).public_pool_days === 0,
  "auto public pool disabled by default"
);
assert(
  app.call(
    "customer.publicPool.update",
    { public_pool_days: 30 },
    admin
  ).ok,
  "configure public pool days"
);
const staleCustomerId = createCustomer("长期未跟进", "13511110004");
app.db
  .prepare(`UPDATE customers SET created_at = ?, updated_at = ? WHERE id = ?`)
  .run("2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z", staleCustomerId);
const poolRun = app.call("customer.publicPool.run", {}, manager);
assert(poolRun.ok && dataOf<any>(poolRun).moved === 1, "stale private customer moved public");
const stale = app.db.prepare(`SELECT * FROM customers WHERE id = ?`).get(staleCustomerId) as any;
assert(stale.visibility === "public" && stale.status === "public_pool", "public pool state set");

const house = app.call(
  "house.create",
  {
    title: "过户测试房源",
    deal_type: "sale",
    community: "测试小区",
    price: 220,
    owner_name: "业主",
    owner_phone: "13611110000",
    status: "available",
  },
  agent
);
assert(house.ok, "create transfer house");
const dealCustomerId = createCustomer("成交客户", "13511110005");
const deal = app.call(
  "deal.create",
  {
    house_id: dataOf<any>(house).id,
    customer_id: dealCustomerId,
    contract_price: 215,
    commission_owner: 10000,
    commission_customer: 10000,
    agent_ids: [agentMe.id],
    split_ratios: { [agentMe.id]: 100 },
  },
  agent
);
assert(deal.ok, "create transfer deal");
const dealId = dataOf<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit transfer deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve transfer deal");

const transfer = app.call(
  "transfer.create",
  {
    deal_id: dealId,
    node_type: "tax",
    title: "缴纳契税",
    planned_at: new Date().toISOString(),
    assignee_user_id: agentMe.id,
  },
  manager
);
assert(transfer.ok, "create transfer node");
const transferId = dataOf<any>(transfer).id;
assert(
  app.call(
    "transfer.status",
    { id: transferId, status: "in_progress" },
    agent
  ).ok,
  "agent starts assigned transfer node"
);
assert(
  app.call(
    "transfer.status",
    { id: transferId, status: "completed" },
    agent
  ).ok,
  "agent completes transfer node"
);

const month = new Date().toISOString().slice(0, 7);
const report = app.call("report.business", { month }, manager);
assert(
  report.ok &&
    dataOf<any>(report).deals_approved >= 1 &&
    dataOf<any>(report).rankings.length >= 1,
  "monthly business summary and rankings"
);
const csv = app.call("report.dealsCsv", { month }, manager);
assert(
  csv.ok &&
    dataOf<any>(csv).content.startsWith("\uFEFF") &&
    dataOf<any>(csv).content.includes(dealId),
  "UTF-8 BOM deals CSV export"
);

console.log(`P2B smoke result: passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
