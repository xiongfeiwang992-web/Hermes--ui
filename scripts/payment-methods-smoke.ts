import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "payment-methods-smoke.db")).dbPath);
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

const defaults = data<any[]>(app.call("config.paymentMethods", {}, finance));
assert(defaults.length >= 5, "default payment methods available");
assert(
  defaults.some((item) => item.value === "transfer" && item.label === "转账"),
  "default includes transfer"
);
assert(
  defaults.some((item) => item.value === "wechat" && item.label === "微信"),
  "default includes wechat"
);

const house = app.call(
  "house.create",
  {
    title: "收款方式房源",
    deal_type: "sale",
    community: "字典苑",
    price: 220,
    owner_name: "业主",
    owner_phone: "13480001001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "收款方式客户", phone: "13480002002", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 220,
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
    { deal_id: dealId, amount: 1000, method: "carrier_pigeon" },
    finance
  ).ok,
  "reject unknown payment method"
);

const bankAlias = app.call(
  "payment.create",
  { deal_id: dealId, amount: 3000, method: "bank", payer_side: "customer" },
  finance
);
assert(bankAlias.ok, "bank alias accepted");
assert(
  data<any[]>(app.call("payment.list", { deal_id: dealId }, finance)).some(
    (row) =>
      row.id === data<any>(bankAlias).id &&
      row.method === "transfer" &&
      row.method_label === "转账"
  ),
  "bank normalized to transfer with label"
);

const wechatPay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 2000, method: "wechat", payer_side: "owner" },
  finance
);
assert(wechatPay.ok, "create wechat payment");
assert(
  data<any[]>(app.call("payment.list", { method: "wechat" }, finance)).some(
    (row) => row.id === data<any>(wechatPay).id && row.method_label === "微信"
  ),
  "list filter by payment method"
);

assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "payment_method", value: "pos", label: "刷卡POS", sort_order: 10 },
    admin
  ).ok,
  "admin adds custom payment method"
);
const methods = data<any[]>(app.call("config.paymentMethods", {}, finance));
assert(
  methods.some((item) => item.value === "pos" && item.label === "刷卡POS"),
  "paymentMethods includes custom entry"
);
assert(
  !methods.some((item) => item.value === "transfer"),
  "custom dictionary replaces defaults"
);

assert(
  !app.call(
    "payment.create",
    { deal_id: dealId, amount: 500, method: "transfer" },
    finance
  ).ok,
  "default method rejected after custom dictionary overrides"
);

const customPay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 1500, method: "pos", payer_side: "customer" },
  finance
);
assert(customPay.ok, "create with custom payment method");
assert(
  data<any[]>(app.call("payment.list", {}, finance)).some(
    (row) => row.id === data<any>(customPay).id && row.method_label === "刷卡POS"
  ),
  "list shows custom method label"
);

assert(app.call("payment.confirm", { id: data<any>(customPay).id }, finance).ok, "confirm custom");
const refund = app.call(
  "payment.refund",
  { deal_id: dealId, amount: 500, reason: "部分退佣", method: "pos" },
  finance
);
assert(refund.ok, "refund with custom method");

const earnest = app.call(
  "earnest.create",
  {
    customer_id: data<any>(customer).id,
    house_id: data<any>(house).id,
    amount: 2000,
    method: "pos",
  },
  agent
);
assert(earnest.ok, "earnest accepts dictionary method");
assert(
  data<any[]>(app.call("earnest.list", {}, agent)).some(
    (row) => row.id === data<any>(earnest).id && row.method === "pos" && row.method_label === "刷卡POS"
  ),
  "earnest list shows method label"
);

assert(
  !app.call(
    "earnest.create",
    {
      customer_id: data<any>(customer).id,
      house_id: data<any>(house).id,
      amount: 1000,
      method: "carrier_pigeon",
    },
    agent
  ).ok,
  "earnest rejects unknown method"
);

console.log(`Payment methods smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
