import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "cashbook-smoke.db")).dbPath);
const voucherPath = path.resolve("/tmp", "cashbook-voucher.txt");
fs.writeFileSync(voucherPath, "local cashbook voucher");
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
const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentC = login("agent_c");
const options = app.call("cashbook.options", {}, finance);
check(options.ok && data<any>(options).stores.length === 2, "finance gets company cashbook options");
const storeA = data<any>(options).stores.find((store: any) => store.name === "一号店").id;
const storeB = data<any>(options).stores.find((store: any) => store.name === "二号店").id;
check(
  data<any>(app.call("cashbook.options", {}, manager)).stores.length === 1,
  "manager options restricted to own store"
);
check(!app.call("cashbook.list", {}, agentA).ok, "agent cannot read cashbook");
check(
  !app.call(
    "cashbook.create",
    {
      store_id: storeA,
      direction: "income",
      category: "commission",
      amount: 100,
      occurred_at: "2026-08-08T09:00:00.000Z",
      payment_method: "bank",
    },
    manager
  ).ok,
  "manager cannot create cashbook entry"
);
check(
  !app.call(
    "cashbook.create",
    {
      store_id: storeA,
      direction: "income",
      category: "office",
      amount: 100,
      occurred_at: "2026-08-08T09:00:00.000Z",
      payment_method: "bank",
    },
    finance
  ).ok,
  "reject category inconsistent with direction"
);
check(
  !app.call(
    "cashbook.create",
    {
      store_id: storeA,
      direction: "income",
      category: "commission",
      amount: 0,
      occurred_at: "2026-08-08T09:00:00.000Z",
      payment_method: "bank",
    },
    finance
  ).ok,
  "reject non-positive cashbook amount"
);
const income = app.call(
  "cashbook.create",
  {
    store_id: storeA,
    direction: "income",
    category: "commission",
    amount: 1000,
    occurred_at: "2026-08-08T09:00:00.000Z",
    payment_method: "bank",
    counterparty: "购房客户",
    note: "佣金到账",
  },
  finance
);
check(income.ok, "finance records income");
const incomeId = data<any>(income).id;
const expense = app.call(
  "cashbook.create",
  {
    store_id: storeA,
    direction: "expense",
    category: "office",
    amount: 300,
    occurred_at: "2026-08-08T10:00:00.000Z",
    payment_method: "wechat",
    counterparty: "办公用品店",
  },
  finance
);
check(expense.ok, "finance records expense");
const expenseId = data<any>(expense).id;

const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const house = app.call(
  "house.create",
  {
    title: "收支关联成交房源",
    deal_type: "sale",
    community: "账本小区",
    price: 180,
    owner_name: "账本业主",
    owner_phone: "13730000001",
    status: "available",
  },
  agentA
);
const customer = app.call(
  "customer.create",
  { name: "收支关联客户", phone: "13830000001", intent: "buy" },
  agentA
);
check(house.ok && customer.ok, "create house and customer for linked deal");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 175,
    commission_owner: 200,
    commission_customer: 0,
    agent_ids: [agentAId],
    split_ratios: { [agentAId]: 100 },
  },
  agentA
);
check(
  deal.ok &&
    app.call("deal.submit", { id: data<any>(deal).id }, agentA).ok &&
    app.call("deal.approve", { id: data<any>(deal).id }, manager).ok,
  "create and approve linked deal"
);
const linkedIncome = app.call(
  "cashbook.create",
  {
    store_id: storeA,
    direction: "income",
    category: "service",
    amount: 200,
    occurred_at: "2026-08-08T11:00:00.000Z",
    payment_method: "cash",
    deal_id: data<any>(deal).id,
  },
  finance
);
check(linkedIncome.ok, "record cashbook income linked to same-store deal");
check(
  !app.call(
    "cashbook.create",
    {
      store_id: storeB,
      direction: "income",
      category: "service",
      amount: 200,
      occurred_at: "2026-08-08T11:00:00.000Z",
      payment_method: "cash",
      deal_id: data<any>(deal).id,
    },
    finance
  ).ok,
  "reject deal linked across stores"
);
const summary = app.call(
  "cashbook.summary",
  {
    start_at: "2026-08-01T00:00:00.000Z",
    end_at: "2026-08-31T23:59:59.999Z",
  },
  finance
);
check(
  summary.ok &&
    data<any>(summary).income === 1200 &&
    data<any>(summary).expense === 300 &&
    data<any>(summary).balance === 900 &&
    data<any>(summary).count === 3,
  "cashbook summary calculates income expense and balance"
);
check(
  data<any[]>(app.call("cashbook.list", {}, manager)).length === 3,
  "manager sees own-store cashbook"
);
check(
  !app.call(
    "cashbook.void",
    { id: expenseId, reason: "无权限作废" },
    manager
  ).ok,
  "manager cannot void entry"
);
check(
  !app.call("cashbook.void", { id: expenseId, reason: "" }, finance).ok,
  "voiding requires reason"
);
check(
  app.call(
    "cashbook.void",
    { id: expenseId, reason: "重复登记" },
    finance
  ).ok,
  "finance voids entry with reason"
);
check(
  !app.call(
    "cashbook.void",
    { id: expenseId, reason: "再次作废" },
    finance
  ).ok,
  "voided entry cannot be voided twice"
);
const afterVoid = app.call("cashbook.summary", {}, manager);
check(
  afterVoid.ok &&
    data<any>(afterVoid).income === 1200 &&
    data<any>(afterVoid).expense === 0 &&
    data<any>(afterVoid).balance === 1200,
  "voided entry excluded from summary"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "cashbook_entry",
      parent_id: incomeId,
      category: "cashbook_voucher",
      name: "越权凭证.txt",
      local_path: voucherPath,
    },
    manager
  ).ok,
  "manager cannot upload cashbook voucher"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "cashbook_entry",
      parent_id: incomeId,
      category: "invalid",
      name: "错误分类.txt",
      local_path: voucherPath,
    },
    finance
  ).ok,
  "cashbook attachment category enforced"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "cashbook_entry",
      parent_id: incomeId,
      category: "cashbook_voucher",
      name: "银行回单.txt",
      local_path: voucherPath,
    },
    finance
  ).ok,
  "finance uploads cashbook voucher"
);
const attachments = app.call(
  "attachment.list",
  { parent_type: "cashbook_entry", parent_id: incomeId },
  manager
);
check(
  attachments.ok && data<any[]>(attachments).length === 1,
  "manager reads own-store cashbook voucher"
);
check(
  !app.call(
    "attachment.list",
    { parent_type: "cashbook_entry", parent_id: incomeId },
    agentB
  ).ok,
  "agent cannot read cashbook voucher"
);
const storeBEntry = app.call(
  "cashbook.create",
  {
    store_id: storeB,
    direction: "expense",
    category: "rent",
    amount: 50,
    occurred_at: "2026-08-08T12:00:00.000Z",
    payment_method: "bank",
  },
  admin
);
check(storeBEntry.ok, "admin records another-store expense");
check(
  data<any[]>(app.call("cashbook.list", {}, manager)).length === 3,
  "manager remains isolated from another store"
);
check(
  data<any[]>(app.call("cashbook.list", {}, finance)).length === 4,
  "finance sees company-wide cashbook"
);
check(
  !app.call("cashbook.list", {}, agentC).ok,
  "cross-store agent has no cashbook access"
);
const managerCsv = app.call("cashbook.export", {}, manager);
check(
  managerCsv.ok &&
    data<any>(managerCsv).rows === 3 &&
    data<any>(managerCsv).content.includes(incomeId) &&
    !data<any>(managerCsv).content.includes(storeBEntry.ok ? data<any>(storeBEntry).id : ""),
  "manager CSV export follows store scope"
);
const financeCsv = app.call("cashbook.export", {}, finance);
check(
  financeCsv.ok &&
    data<any>(financeCsv).rows === 4 &&
    data<any>(financeCsv).content.startsWith("\uFEFF"),
  "finance exports company cashbook as UTF-8 CSV"
);
const filtered = app.call(
  "cashbook.list",
  {
    direction: "income",
    start_at: "2026-08-08T00:00:00.000Z",
    end_at: "2026-08-08T23:59:59.999Z",
  },
  finance
);
check(
  filtered.ok && data<any[]>(filtered).length === 2,
  "cashbook filters by direction and date"
);

console.log(`Cashbook smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
