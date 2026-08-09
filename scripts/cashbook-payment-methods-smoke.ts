import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const receiptPath = path.resolve("/tmp", "cashbook-payment-methods-receipt.txt");
fs.writeFileSync(receiptPath, "expense receipt for payment method dict");

const app = createApp(
  seedDatabase(path.resolve("data", "cashbook-payment-methods-smoke.db")).dbPath
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

const admin = login("admin");
const manager = login("manager");
const finance = login("finance");
const agent = login("agent_a");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const storeA = data<any>(app.call("auth.me", {}, finance)).store_id;

assert(
  !app.call(
    "cashbook.create",
    {
      store_id: storeA,
      direction: "income",
      category: "commission",
      amount: 100,
      occurred_at: "2026-08-08T09:00:00.000Z",
      payment_method: "carrier_pigeon",
    },
    finance
  ).ok,
  "cashbook rejects unknown payment method"
);

const bankAlias = app.call(
  "cashbook.create",
  {
    store_id: storeA,
    direction: "income",
    category: "commission",
    amount: 800,
    occurred_at: "2026-08-08T09:00:00.000Z",
    payment_method: "bank",
    counterparty: "字典客户",
  },
  finance
);
assert(bankAlias.ok, "cashbook accepts bank alias");
const bankId = data<any>(bankAlias).id;
const bankRow = data<any[]>(app.call("cashbook.list", {}, finance)).find(
  (row) => row.id === bankId
);
assert(bankRow?.payment_method === "transfer", "bank normalized to transfer");
assert(bankRow?.payment_method_label === "转账", "cashbook list shows transfer label");

const wechat = app.call(
  "cashbook.create",
  {
    store_id: storeA,
    direction: "expense",
    category: "office",
    amount: 50,
    occurred_at: "2026-08-08T10:00:00.000Z",
    payment_method: "微信",
  },
  finance
);
assert(wechat.ok, "cashbook accepts Chinese wechat alias");
const wechatId = data<any>(wechat).id;
assert(
  data<any[]>(app.call("cashbook.list", {}, finance)).some(
    (row) => row.id === wechatId && row.payment_method === "wechat" && row.payment_method_label === "微信"
  ),
  "wechat alias normalized with label"
);

const csv = app.call("cashbook.export", {}, finance);
assert(
  csv.ok &&
    data<any>(csv).content.includes("转账") &&
    data<any>(csv).content.includes("微信"),
  "cashbook export uses payment method labels"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "payment_method", value: "pos", label: "POS刷卡", sort_order: 20 },
    admin
  ).ok,
  "admin adds custom payment method"
);
assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "payment_method", value: "cash", label: "现金", sort_order: 1 },
    admin
  ).ok,
  "admin keeps cash in custom dict"
);

const customCashbook = app.call(
  "cashbook.create",
  {
    store_id: storeA,
    direction: "income",
    category: "other_income",
    amount: 30,
    occurred_at: "2026-08-08T11:00:00.000Z",
    payment_method: "pos",
  },
  finance
);
assert(customCashbook.ok, "cashbook accepts custom dict method");
assert(
  data<any[]>(app.call("cashbook.list", {}, finance)).some(
    (row) =>
      row.id === data<any>(customCashbook).id &&
      row.payment_method === "pos" &&
      row.payment_method_label === "POS刷卡"
  ),
  "custom cashbook method label"
);
assert(
  !app.call(
    "cashbook.create",
    {
      store_id: storeA,
      direction: "income",
      category: "commission",
      amount: 10,
      occurred_at: "2026-08-08T11:30:00.000Z",
      payment_method: "wechat",
    },
    finance
  ).ok,
  "default wechat rejected after custom dict override"
);

const expenseDraft = app.call(
  "expense.create",
  {
    title: "字典报销",
    category: "office",
    amount: 120,
    expense_date: "2026-08-08",
    description: "测试付款方式字典",
  },
  agent
);
assert(expenseDraft.ok, "create expense draft");
const expenseId = data<any>(expenseDraft).id;
assert(
  app.call(
    "attachment.add",
    {
      parent_type: "expense_request",
      parent_id: expenseId,
      category: "expense_receipt",
      name: "票据.txt",
      local_path: receiptPath,
    },
    agent
  ).ok,
  "upload expense receipt"
);
assert(app.call("expense.submit", { id: expenseId }, agent).ok, "submit expense");
assert(
  app.call("expense.review", { id: expenseId, status: "approved" }, manager).ok,
  "approve expense"
);

assert(
  !app.call(
    "expense.pay",
    { id: expenseId, payment_method: "carrier_pigeon", payment_reference: "X" },
    finance
  ).ok,
  "expense rejects unknown payment method"
);
assert(
  !app.call(
    "expense.pay",
    { id: expenseId, payment_method: "pos", payment_reference: "" },
    finance
  ).ok,
  "non-cash expense requires reference"
);
assert(
  app.call(
    "expense.pay",
    { id: expenseId, payment_method: "pos", payment_reference: "POS-1001" },
    finance
  ).ok,
  "expense pays with custom method"
);
const paid = data<any[]>(app.call("expense.list", { status: "paid" }, finance)).find(
  (row) => row.id === expenseId
);
assert(paid?.payment_method === "pos", "expense stores custom method");
assert(paid?.payment_method_label === "POS刷卡", "expense list shows method label");

const house = app.call(
  "house.create",
  {
    title: "字典收支房",
    deal_type: "sale",
    community: "字典苑",
    price: 100,
    owner_name: "业主",
    owner_phone: "13580001001",
    status: "available",
  },
  agent
);
const customer = app.call(
  "customer.create",
  { name: "字典收支客", phone: "13580002001", intent: "buy" },
  agent
);
assert(house.ok && customer.ok, "create house/customer for sanity");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 100,
    commission_owner: 1000,
    commission_customer: 800,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal sanity");

console.log(`Cashbook payment methods smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
