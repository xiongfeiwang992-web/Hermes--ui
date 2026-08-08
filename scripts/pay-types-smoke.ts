import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "pay-types-smoke.db")).dbPath);
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

const defaults = data<any[]>(app.call("config.payTypes", {}, finance));
assert(defaults.length >= 5, "default pay types available");
assert(
  defaults.some((item) => item.value === "commission" && item.label === "佣金"),
  "default includes commission"
);
assert(
  defaults.some((item) => item.value === "earnest_apply" && item.label === "意向金冲抵"),
  "default includes earnest_apply"
);

const house = app.call(
  "house.create",
  {
    title: "收款类型房源",
    deal_type: "sale",
    community: "字典苑",
    price: 210,
    owner_name: "业主",
    owner_phone: "13490001001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "收款类型客户", phone: "13490002002", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 210,
    commission_owner: 10000,
    commission_customer: 8000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve deal");

assert(
  !app.call(
    "payment.create",
    { deal_id: dealId, amount: 1000, pay_type: "carrier_pigeon" },
    finance
  ).ok,
  "reject unknown pay type"
);

const defaultPay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 3000, method: "transfer", payer_side: "customer" },
  finance
);
assert(defaultPay.ok, "create without pay_type defaults commission");
assert(
  data<any[]>(app.call("payment.list", { deal_id: dealId }, finance)).some(
    (row) =>
      row.id === data<any>(defaultPay).id &&
      row.pay_type === "commission" &&
      row.pay_type_label === "佣金"
  ),
  "list shows default commission label"
);

const depositPay = app.call(
  "payment.create",
  {
    deal_id: dealId,
    amount: 2000,
    pay_type: "定金",
    method: "cash",
    payer_side: "customer",
  },
  finance
);
assert(depositPay.ok, "Chinese alias 定金 accepted");
assert(
  data<any[]>(app.call("payment.list", { pay_type: "deposit" }, finance)).some(
    (row) => row.id === data<any>(depositPay).id && row.pay_type_label === "定金"
  ),
  "list filter by pay_type"
);

assert(
  !app.call(
    "payment.create",
    { deal_id: dealId, amount: 500, pay_type: "refund" },
    finance
  ).ok,
  "createPayment rejects refund type"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "pay_type", value: "agency_fee", label: "代办费", sort_order: 1 },
    admin
  ).ok,
  "admin adds custom pay type"
);
assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "pay_type", value: "refund", label: "退款", sort_order: 9 },
    admin
  ).ok,
  "admin keeps refund in custom dictionary"
);

const types = data<any[]>(app.call("config.payTypes", {}, finance));
assert(
  types.some((item) => item.value === "agency_fee" && item.label === "代办费"),
  "payTypes includes custom entry"
);
assert(
  !types.some((item) => item.value === "commission"),
  "custom dictionary replaces defaults"
);

assert(
  !app.call(
    "payment.create",
    { deal_id: dealId, amount: 500, pay_type: "commission" },
    finance
  ).ok,
  "default pay type rejected after custom dictionary overrides"
);

const customPay = app.call(
  "payment.create",
  {
    deal_id: dealId,
    amount: 1500,
    pay_type: "agency_fee",
    method: "transfer",
    payer_side: "owner",
  },
  finance
);
assert(customPay.ok, "create with custom pay type");
assert(
  data<any[]>(app.call("payment.list", {}, finance)).some(
    (row) => row.id === data<any>(customPay).id && row.pay_type_label === "代办费"
  ),
  "list shows custom pay type label"
);

assert(app.call("payment.confirm", { id: data<any>(customPay).id }, finance).ok, "confirm custom");
assert(app.call("payment.confirm", { id: data<any>(defaultPay).id }, finance).ok, "confirm default");
const refund = app.call(
  "payment.refund",
  { deal_id: dealId, amount: 500, reason: "部分退佣" },
  finance
);
assert(refund.ok, "refund forces pay_type refund");
assert(
  data<any[]>(app.call("payment.list", { pay_type: "refund" }, finance)).some(
    (row) => row.id === data<any>(refund).id && row.pay_type_label === "退款"
  ),
  "refund listed with pay_type_label"
);

console.log(`Pay types smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
