import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "specialized-smoke.db")).dbPath);
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
const agent = login("agent_a");
const otherAgent = login("agent_b");
const finance = login("finance");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

assert(
  app.call(
    "config.preferences.save",
    { list_density: "compact", watermark_enabled: true, theme: "system" },
    agent
  ).ok,
  "save user preferences"
);
assert(
  data<any>(app.call("config.preferences.get", {}, agent)).list_density === "compact",
  "read user preferences"
);
assert(
  app.call(
    "config.dictionary.upsert",
    { dict_type: "follow_method", value: "video", label: "视频沟通", sort_order: 5 },
    admin
  ).ok,
  "upsert data dictionary"
);
assert(
  data<any[]>(app.call("config.dictionary.list", { dict_type: "follow_method" }, agent)).length === 1,
  "list data dictionary"
);
assert(
  app.call(
    "config.settings.save",
    {
      house_hold_limit: 1,
      manager_award_rate: 0.05,
      password_min_length: 8,
      deal_required_fields: ["loan_bank"],
    },
    admin
  ).ok,
  "save specialized settings"
);
assert(
  app.call(
    "config.commissionTiers.save",
    { min_amount: 0, max_amount: 30000, pool_rate: 0.6 },
    admin
  ).ok,
  "save commission tier"
);
assert(
  data<any[]>(app.call("config.commissionTiers.list", {}, manager)).length === 1,
  "list commission tiers"
);

const house = app.call(
  "house.create",
  {
    title: "专项规则房源",
    deal_type: "sale",
    property_type: "office",
    deal_mode: "normal",
    community: "规则小区",
    price: 200,
    owner_name: "业主",
    owner_phone: "13710000001",
    status: "available",
  },
  agent
);
assert(house.ok, "create first held house");
assert(
  !app.call(
    "house.create",
    {
      title: "超限房源",
      deal_type: "sale",
      community: "规则小区",
      price: 210,
      owner_name: "业主二",
      owner_phone: "13710000002",
    },
    agent
  ).ok,
  "enforce personal house hold limit"
);
assert(app.call("house.lock", { id: data<any>(house).id, locked: true }, agent).ok, "lock own house");

const customer = app.call(
  "customer.create",
  {
    name: "保密客户",
    phone: "13810000001",
    intent: "buy",
    is_confidential: true,
  },
  agent
);
assert(customer.ok, "create confidential customer");
assert(
  !data<any[]>(app.call("customer.list", {}, otherAgent)).some(
    (item) => item.id === data<any>(customer).id
  ),
  "hide confidential customer from other agent"
);

const invalidDeal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 195,
    commission_owner: 10000,
    commission_customer: 10000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(!invalidDeal.ok, "enforce configured deal required fields");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 195,
    commission_owner: 10000,
    commission_customer: 10000,
    loan_amount: 100,
    loan_bank: "示例银行",
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal with loan fields");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit specialized deal");
assert(
  app.call(
    "contract.sign",
    { deal_id: dealId, statement: "本人确认成交内容真实无误" },
    agent
  ).ok,
  "local deal signoff"
);
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve specialized deal");
assert(
  data<any[]>(app.call("commission.list", {}, finance)).length === 2,
  "generate agent commission and manager award"
);
assert(
  data<any[]>(app.call("commission.list", {}, agent)).some(
    (item) => item.user_id === agentId && item.amount === 12000
  ),
  "apply matching commission tier rate"
);
assert(
  app.call(
    "payment.create",
    { deal_id: dealId, amount: 10000, method: "transfer", payer_side: "customer" },
    finance
  ).ok,
  "create payment before refund"
);
assert(
  app.call(
    "payment.refund",
    { deal_id: dealId, amount: 2000, reason: "佣金调整", method: "transfer" },
    finance
  ).ok,
  "create payment refund"
);
assert(data<any>(app.call("deal.get", { id: dealId }, finance)).paid_amount === 8000, "refund reduces net paid");

assert(
  app.call(
    "contract.template.save",
    { name: "二手买卖模板", deal_type: "sale", content: "甲方{{owner}}乙方{{customer}}" },
    admin
  ).ok,
  "save local contract template"
);
assert(data<any[]>(app.call("contract.templates", {}, agent)).length === 1, "list contract templates");

console.log(`Specialized smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
