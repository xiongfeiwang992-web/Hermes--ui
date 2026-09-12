import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";
import {
  formatMaskedPhone,
  isMaskedPhoneFormat,
  MASKED_PHONE_PATTERN,
  maskPhone,
} from "../server/auth/policy";

const app = createApp(seedDatabase(path.resolve("data", "masked-phone-display-smoke.db")).dbPath);
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

assert(maskPhone("13810008686") === "138****8686", "maskPhone stable format");
assert(formatMaskedPhone("13810008686") === "138****8686", "formatMaskedPhone from raw");
assert(formatMaskedPhone("138****8686") === "138****8686", "formatMaskedPhone idempotent");
assert(isMaskedPhoneFormat("138****8686"), "isMaskedPhoneFormat true");
assert(!isMaskedPhoneFormat("13810008686"), "isMaskedPhoneFormat false for full");
assert(MASKED_PHONE_PATTERN.test("139****1234"), "MASKED_PHONE_PATTERN matches");

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");

const FULL_HOUSE_PHONE = "13820001111";
const FULL_CUSTOMER_PHONE = "13920002222";
const MASKED_HOUSE = maskPhone(FULL_HOUSE_PHONE);
const MASKED_CUSTOMER = maskPhone(FULL_CUSTOMER_PHONE);

const houseCreate = app.call(
  "house.create",
  {
    title: "展示隐号房源",
    deal_type: "sale",
    community: "隐号苑",
    price: 210,
    owner_name: "业主隐",
    owner_phone: FULL_HOUSE_PHONE,
    status: "available",
    is_private: false,
  },
  agentA
);
assert(houseCreate.ok, "agent A create non-private house");
const houseId = data<any>(houseCreate).id;
assert(data<any>(houseCreate).owner_phone === FULL_HOUSE_PHONE, "holder create sees full phone");
assert(data<any>(houseCreate).owner_phone_masked === false, "holder create not masked");

const holderList = data<any[]>(app.call("house.list", {}, agentA));
const holderRow = holderList.find((row) => row.id === houseId);
assert(holderRow?.owner_phone === FULL_HOUSE_PHONE, "holder list full phone");
assert(holderRow?.owner_phone_masked === false, "holder list not masked");

const peerList = data<any[]>(app.call("house.list", {}, agentB));
const peerRow = peerList.find((row) => row.id === houseId);
assert(Boolean(peerRow), "same-store peer can list non-private house");
assert(peerRow?.owner_phone_masked === true, "peer owner_phone_masked true");
assert(peerRow?.owner_phone === MASKED_HOUSE, "peer masked phone equals maskPhone");
assert(MASKED_PHONE_PATTERN.test(peerRow?.owner_phone || ""), "peer phone matches mask pattern");
assert(!String(peerRow?.owner_phone || "").includes(FULL_HOUSE_PHONE), "peer list omits full number");
assert(!String(JSON.stringify(peerRow)).includes(FULL_HOUSE_PHONE), "peer row JSON omits full number");

const peerGet = data<any>(app.call("house.get", { id: houseId }, agentB));
assert(peerGet.owner_phone_masked === true, "peer get masked flag");
assert(peerGet.owner_phone === MASKED_HOUSE, "peer get masked phone");

const managerGet = data<any>(app.call("house.get", { id: houseId }, manager));
assert(managerGet.owner_phone === FULL_HOUSE_PHONE, "manager sees full house phone");
assert(managerGet.owner_phone_masked === false, "manager not masked");

const adminGet = data<any>(app.call("house.get", { id: houseId }, admin));
assert(adminGet.owner_phone === FULL_HOUSE_PHONE, "admin sees full house phone");

const related = data<any>(app.call("house.relatedByOwner", { id: houseId }, agentB));
assert(related.owner_phone_masked === true, "relatedByOwner exposes owner_phone_masked");
assert(related.owner_phone === MASKED_HOUSE, "relatedByOwner header phone masked");
assert(!String(related.owner_phone).includes("2000"), "related omits mid digits");

const privateCustomer = app.call(
  "customer.create",
  {
    name: "私客隐号",
    phone: "13730003333",
    intent: "buy",
    need: "私客不可见",
  },
  agentA
);
assert(privateCustomer.ok, "agent A create private customer");
const privateCustomerId = data<any>(privateCustomer).id;
assert(
  !data<any[]>(app.call("customer.list", {}, agentB)).some((row) => row.id === privateCustomerId),
  "peer cannot list private customer"
);
assert(
  !app.call("customer.get", { id: privateCustomerId }, agentB).ok,
  "peer cannot get private customer"
);

const publicCustomer = app.call(
  "customer.create",
  {
    name: "公客隐号",
    phone: FULL_CUSTOMER_PHONE,
    intent: "buy",
    need: "展示型隐号",
  },
  agentA
);
assert(publicCustomer.ok, "agent A create customer for public");
const publicCustomerId = data<any>(publicCustomer).id;
assert(app.call("customer.toPublic", { id: publicCustomerId, reason: "公客隐号验收" }, agentA).ok, "toPublic ok");

const peerCustomers = data<any[]>(app.call("customer.list", { visibility: "public" }, agentB));
const peerCustomer = peerCustomers.find((row) => row.id === publicCustomerId);
assert(Boolean(peerCustomer), "peer can list public customer");
assert(peerCustomer?.phone_masked === true, "peer customer phone_masked true");
assert(peerCustomer?.phone === MASKED_CUSTOMER, "peer customer masked phone");
assert(MASKED_PHONE_PATTERN.test(peerCustomer?.phone || ""), "peer customer mask pattern");
assert(!String(JSON.stringify(peerCustomer)).includes(FULL_CUSTOMER_PHONE), "peer customer omits full");

console.log(`Masked phone display smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
