import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "hold-limit-rent-sale-smoke.db")).dbPath);
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
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

check(
  !app.call(
    "config.settings.save",
    {
      house_hold_limit_sale: 0,
      house_hold_limit_rent: 2,
      manager_award_rate: 0.05,
      password_min_length: 8,
    },
    admin
  ).ok,
  "reject invalid sale hold limit"
);

check(
  app.call(
    "config.settings.save",
    {
      house_hold_limit_sale: 1,
      house_hold_limit_rent: 2,
      manager_award_rate: 0.05,
      password_min_length: 8,
      deal_required_fields: [],
    },
    admin
  ).ok,
  "save separate rent/sale hold limits"
);

const settings = data<any>(app.call("config.settings.get", {}, manager));
check(
  settings.house_hold_limit_sale === 1 &&
    settings.house_hold_limit_rent === 2 &&
    settings.house_hold_limit === 2,
  "settings expose sale/rent limits and legacy max"
);

const sale1 = app.call(
  "house.create",
  {
    title: "出售持盘1",
    deal_type: "sale",
    community: "持盘小区",
    price: 200,
    owner_name: "业主A",
    owner_phone: "13771000001",
    status: "available",
  },
  agentA
);
check(sale1.ok, "create first sale house within sale limit");
const sale1Id = data<any>(sale1).id;

const sale2 = app.call(
  "house.create",
  {
    title: "出售持盘超限",
    deal_type: "sale",
    community: "持盘小区",
    price: 210,
    owner_name: "业主B",
    owner_phone: "13771000002",
    status: "available",
  },
  agentA
);
check(!sale2.ok && String(sale2.message).includes("出售"), "block second sale over sale limit");

const rent1 = app.call(
  "house.create",
  {
    title: "出租持盘1",
    deal_type: "rent",
    community: "持盘小区",
    price: 3000,
    owner_name: "业主C",
    owner_phone: "13771000003",
    status: "available",
  },
  agentA
);
check(rent1.ok, "sale limit does not block rent create");
const rent2 = app.call(
  "house.create",
  {
    title: "出租持盘2",
    deal_type: "rent",
    community: "持盘小区",
    price: 3200,
    owner_name: "业主D",
    owner_phone: "13771000004",
    status: "available",
  },
  agentA
);
check(rent2.ok, "create second rent within rent limit");
const rent3 = app.call(
  "house.create",
  {
    title: "出租持盘超限",
    deal_type: "rent",
    community: "持盘小区",
    price: 3300,
    owner_name: "业主E",
    owner_phone: "13771000005",
    status: "available",
  },
  agentA
);
check(!rent3.ok && String(rent3.message).includes("出租"), "block third rent over rent limit");

const peerSale = app.call(
  "house.create",
  {
    title: "乙出售待转",
    deal_type: "sale",
    community: "持盘小区",
    price: 220,
    owner_name: "业主F",
    owner_phone: "13771000006",
    status: "available",
  },
  agentB
);
check(peerSale.ok, "agent B creates sale house");
const peerSaleId = data<any>(peerSale).id;

check(
  !app.call("house.agent", { id: peerSaleId, agent_id: agentAId }, manager).ok,
  "change holder blocked when target at sale limit"
);

check(
  app.call(
    "config.settings.save",
    {
      house_hold_limit: 3,
      manager_award_rate: 0.05,
      password_min_length: 8,
      deal_required_fields: [],
    },
    admin
  ).ok,
  "legacy house_hold_limit still syncs both sides"
);
const synced = data<any>(app.call("config.settings.get", {}, admin));
check(
  synced.house_hold_limit_sale === 3 &&
    synced.house_hold_limit_rent === 3 &&
    synced.house_hold_limit === 3,
  "legacy save fills sale and rent limits"
);

check(
  app.call("house.agent", { id: peerSaleId, agent_id: agentAId }, manager).ok,
  "change holder allowed after raising sale limit"
);
check(agentBId && sale1Id, "fixture ids retained");

console.log(`Hold limit rent/sale smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
