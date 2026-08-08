import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "message-subscriptions-smoke.db")).dbPath
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

const manager = login("manager");
const agent = login("agent_a");
const finance = login("finance");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const defaults = data<any>(app.call("message.subscriptions.get", {}, agent));
assert(Array.isArray(defaults.channels) && defaults.channels.length >= 8, "list subscription channels");
assert(
  defaults.channels.every((channel: any) => channel.enabled === true),
  "all channels enabled by default"
);
assert(
  defaults.channels.some((channel: any) => channel.key === "deal" && channel.locked === true),
  "deal channel locked"
);

assert(
  app.call(
    "message.subscriptions.save",
    {
      channels: {
        payment: false,
        follow: false,
        deal: false,
      },
    },
    agent
  ).ok,
  "save muted channels"
);
const saved = data<any>(app.call("message.subscriptions.get", {}, agent));
assert(
  saved.channels.find((channel: any) => channel.key === "payment")?.enabled === false,
  "payment channel muted"
);
assert(
  saved.channels.find((channel: any) => channel.key === "deal")?.enabled === true,
  "deal channel stays enabled despite mute attempt"
);

const house = app.call(
  "house.create",
  {
    title: "订阅测试房源",
    deal_type: "sale",
    community: "消息苑",
    price: 210,
    owner_name: "业主",
    owner_phone: "13550001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "订阅客户", phone: "13550002222", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 210,
    commission_owner: 12000,
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

const beforePay = data<any[]>(app.call("message.list", {}, agent)).filter(
  (msg) => msg.kind === "payment"
).length;
const pay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 5000, method: "transfer", payer_side: "customer" },
  finance
);
assert(pay.ok, "create pending payment");
assert(app.call("payment.confirm", { id: data<any>(pay).id }, finance).ok, "confirm payment");
const afterPay = data<any[]>(app.call("message.list", {}, agent)).filter(
  (msg) => msg.kind === "payment"
).length;
assert(afterPay === beforePay, "muted payment channel suppresses payment messages");

assert(
  data<any[]>(app.call("message.list", {}, agent)).some((msg) => msg.kind === "deal_approve"),
  "locked deal channel still delivers approve message"
);

assert(
  app.call(
    "message.subscriptions.save",
    { channels: { payment: true, follow: true } },
    agent
  ).ok,
  "unmute payment channel"
);

const secondPay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 3000, method: "cash", payer_side: "owner" },
  finance
);
assert(secondPay.ok, "create second payment");
assert(
  app.call("payment.confirm", { id: data<any>(secondPay).id }, finance).ok,
  "confirm second payment"
);
assert(
  data<any[]>(app.call("message.list", {}, agent)).filter((msg) => msg.kind === "payment")
    .length === beforePay + 1,
  "unmuted payment channel delivers message"
);

const viewHouse = app.call(
  "house.create",
  {
    title: "带看提醒房源",
    deal_type: "sale",
    community: "消息苑",
    price: 188,
    owner_name: "业主乙",
    owner_phone: "13550003333",
    status: "available",
  },
  agent
);
assert(viewHouse.ok, "create house for view remind");
assert(
  app.call(
    "message.subscriptions.save",
    { channels: { follow: false } },
    agent
  ).ok,
  "mute follow channel"
);
const otherAgent = login("agent_b");
const otherCustomer = app.call(
  "customer.create",
  { name: "带看客户", phone: "13550004444", intent: "buy" },
  otherAgent
);
assert(otherCustomer.ok, "other agent create customer");
const beforeView = data<any[]>(app.call("message.list", {}, agent)).filter(
  (msg) => msg.kind === "view_non_holder"
).length;
assert(
  app.call(
    "view.create",
    {
      customer_id: data<any>(otherCustomer).id,
      house_id: data<any>(viewHouse).id,
      view_at: new Date().toISOString(),
    },
    otherAgent
  ).ok,
  "non-holder create view"
);
assert(
  data<any[]>(app.call("message.list", {}, agent)).filter(
    (msg) => msg.kind === "view_non_holder"
  ).length === beforeView,
  "muted follow channel suppresses non-holder view remind"
);

console.log(`Message subscriptions smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
