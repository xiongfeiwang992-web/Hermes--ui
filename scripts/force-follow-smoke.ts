import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "force-follow-smoke.db")).dbPath);
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
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const defaults = data<any>(app.call("config.settings.get", {}, admin));
assert(Number(defaults.force_follow_before_phone) === 0, "force follow default off");
assert(Number(defaults.non_holder_view_remind) === 1, "non-holder remind default on");

const house = app.call(
  "house.create",
  {
    title: "强制跟进房源",
    deal_type: "sale",
    community: "跟进花园",
    price: 188,
    owner_name: "业主甲",
    owner_phone: "13810008686",
    status: "available",
  },
  agentA
);
assert(house.ok, "agent A create house");
const houseId = data<any>(house).id;
assert(data<any>(house).owner_phone === "13810008686", "phone visible when force follow off");

const customer = app.call(
  "customer.create",
  {
    name: "客户甲",
    phone: "13910008686",
    intent: "buy",
    need: "三房刚需",
  },
  agentA
);
assert(customer.ok, "agent A create customer");
const customerId = data<any>(customer).id;
assert(data<any>(customer).phone === "13910008686", "customer phone visible when off");

assert(
  app.call(
    "config.settings.save",
    {
      house_hold_limit: 20,
      manager_award_rate: 0,
      password_min_length: 8,
      deal_required_fields: [],
      force_follow_before_phone: true,
      non_holder_view_remind: true,
    },
    admin
  ).ok,
  "enable force follow and remind"
);

const gatedHouse = data<any>(app.call("house.get", { id: houseId }, agentA));
assert(gatedHouse.owner_phone_masked === true, "agent phone masked after enable");
assert(gatedHouse.force_follow_required === true, "force follow required for holder agent");
assert(gatedHouse.owner_phone.includes("****"), "masked house phone format");

const managerHouse = data<any>(app.call("house.get", { id: houseId }, manager));
assert(managerHouse.owner_phone === "13810008686", "manager still sees full phone");
assert(managerHouse.force_follow_required !== true, "manager not forced");

const adminHouse = data<any>(app.call("house.get", { id: houseId }, admin));
assert(adminHouse.owner_phone === "13810008686", "admin still sees full phone");

assert(
  !app.call(
    "contact.reveal",
    { target_type: "house", target_id: houseId, content: "短" },
    agentA
  ).ok,
  "reveal rejects short follow"
);

const revealHouse = app.call(
  "contact.reveal",
  {
    target_type: "house",
    target_id: houseId,
    content: "电话联系业主确认看房时间",
    method: "phone",
  },
  agentA
);
assert(revealHouse.ok, "reveal house after force follow");
assert(data<any>(revealHouse).phone === "13810008686", "reveal returns full house phone");

const unlockedHouse = data<any>(app.call("house.get", { id: houseId }, agentA));
assert(unlockedHouse.owner_phone === "13810008686", "house unlocked after follow");
assert(unlockedHouse.force_follow_required !== true, "force follow cleared for house");

const gatedCustomer = data<any>(app.call("customer.get", { id: customerId }, agentA));
assert(gatedCustomer.force_follow_required === true, "customer force follow required");
assert(gatedCustomer.phone_masked === true, "customer phone masked");

const revealCustomer = app.call(
  "contact.reveal",
  {
    target_type: "customer",
    target_id: customerId,
    content: "微信确认客户预算与意向小区",
    method: "wechat",
  },
  agentA
);
assert(revealCustomer.ok, "reveal customer after force follow");
assert(data<any>(revealCustomer).phone === "13910008686", "reveal returns full customer phone");

const otherCustomer = app.call(
  "customer.create",
  {
    name: "客户乙",
    phone: "13920008686",
    intent: "buy",
    visibility: "private",
  },
  agentB
);
assert(otherCustomer.ok, "agent B create private customer");
assert(
  !app.call(
    "contact.reveal",
    {
      target_type: "customer",
      target_id: data<any>(otherCustomer).id,
      content: "试图查看他人私客电话号码",
    },
    agentA
  ).ok,
  "cannot reveal other agent private customer"
);

const beforeMessages = data<any[]>(app.call("message.list", {}, agentA)).filter(
  (m) => m.kind === "view_non_holder"
).length;

const viewByOther = app.call(
  "view.create",
  {
    customer_id: data<any>(otherCustomer).id,
    house_id: houseId,
    view_at: new Date().toISOString(),
    agent_id: agentBId,
    content: "非接盘人带看",
  },
  agentB
);
assert(viewByOther.ok, "non-holder create view");

const afterMessages = data<any[]>(app.call("message.list", {}, agentA)).filter(
  (m) => m.kind === "view_non_holder"
);
assert(afterMessages.length === beforeMessages + 1, "holder receives non-holder view remind");
assert(
  afterMessages.some((m) => m.ref_id === data<any>(viewByOther).id),
  "remind references the view"
);

assert(
  app.call(
    "config.settings.save",
    {
      house_hold_limit: 20,
      manager_award_rate: 0,
      password_min_length: 8,
      deal_required_fields: [],
      force_follow_before_phone: true,
      non_holder_view_remind: false,
    },
    admin
  ).ok,
  "disable non-holder remind"
);

const customerC = app.call(
  "customer.create",
  { name: "客户丙", phone: "13930008686", intent: "rent" },
  agentB
);
assert(customerC.ok, "create customer for second view");
const midMessages = data<any[]>(app.call("message.list", {}, agentA)).filter(
  (m) => m.kind === "view_non_holder"
).length;
const quietView = app.call(
  "view.create",
  {
    customer_id: data<any>(customerC).id,
    house_id: houseId,
    view_at: new Date().toISOString(),
    agent_id: agentBId,
  },
  agentB
);
assert(quietView.ok, "create view while remind off");
assert(
  data<any[]>(app.call("message.list", {}, agentA)).filter((m) => m.kind === "view_non_holder")
    .length === midMessages,
  "no remind when setting off"
);

assert(
  app.call(
    "config.settings.save",
    {
      house_hold_limit: 20,
      manager_award_rate: 0,
      password_min_length: 8,
      deal_required_fields: [],
      force_follow_before_phone: false,
      non_holder_view_remind: true,
    },
    admin
  ).ok,
  "restore defaults via settings"
);
const restored = data<any>(app.call("config.settings.get", {}, admin));
assert(Number(restored.force_follow_before_phone) === 0, "force follow restored off");
assert(Number(restored.non_holder_view_remind) === 1, "remind restored on");
assert(agentAId && agentBId, "agent ids resolved");

console.log(`Force follow smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
