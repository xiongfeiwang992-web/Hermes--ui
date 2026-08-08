import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "blacklist-listing-smoke.db")).dbPath);
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

const blockedPhone = "13860001111";
const otherPhone = "13860002222";

const add = app.call(
  "blacklist.add",
  { kind: "phone", value: blockedPhone, reason: "防骚扰测试" },
  manager
);
assert(add.ok, "manager adds phone to business blacklist");

const blockedCustomer = app.call(
  "customer.create",
  { name: "黑名单客户", phone: blockedPhone, intent: "buy" },
  agent
);
assert(!blockedCustomer.ok, "customer.create rejects blacklisted phone");
assert(
  blockedCustomer.message === "该电话已在业务黑名单中",
  "customer.create blacklist message"
);

const blockedHouse = app.call(
  "house.create",
  {
    title: "黑名单房源",
    deal_type: "sale",
    community: "黑名单苑",
    price: 200,
    owner_name: "业主",
    owner_phone: blockedPhone,
    status: "draft",
  },
  agent
);
assert(!blockedHouse.ok, "house.create rejects blacklisted owner_phone");
assert(
  blockedHouse.message === "该电话已在业务黑名单中",
  "house.create blacklist message"
);

const okCustomer = app.call(
  "customer.create",
  { name: "正常客户", phone: otherPhone, intent: "rent" },
  agent
);
assert(okCustomer.ok, "customer.create allows different phone");

const okHouse = app.call(
  "house.create",
  {
    title: "正常房源",
    deal_type: "sale",
    community: "正常苑",
    price: 210,
    owner_name: "业主乙",
    owner_phone: "13860003333",
    status: "draft",
  },
  agent
);
assert(okHouse.ok, "house.create allows different owner_phone");

const updateBlocked = app.call(
  "customer.update",
  { id: data<any>(okCustomer).id, phone: blockedPhone },
  agent
);
assert(!updateBlocked.ok, "customer.update rejects blacklisted phone");
assert(
  updateBlocked.message === "该电话已在业务黑名单中",
  "customer.update blacklist message"
);

const houseUpdateBlocked = app.call(
  "house.update",
  { id: data<any>(okHouse).id, owner_phone: blockedPhone },
  agent
);
assert(!houseUpdateBlocked.ok, "house.update rejects blacklisted owner_phone");
assert(
  houseUpdateBlocked.message === "该电话已在业务黑名单中",
  "house.update blacklist message"
);

const leadKind = app.call(
  "blacklist.add",
  { kind: "lead", value: "13960004444", reason: "虚假线索" },
  manager
);
assert(leadKind.ok, "manager adds lead blacklist entry");
const marketingBlocked = app.call(
  "marketing.leads.create",
  {
    contact_name: "黑名单线索",
    contact_phone: "13960004444",
    intent: "buy",
    channel: "phone",
  },
  agent
);
assert(!marketingBlocked.ok, "marketing still rejects lead-kind blacklist");
assert(
  marketingBlocked.message === "该电话已在业务或商机黑名单中",
  "marketing blacklist message unchanged"
);

console.log(`Blacklist listing smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
