import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const fixture = path.resolve("data", "rental-payment-methods-fixture.txt");
fs.writeFileSync(fixture, "rental payment methods fixture", "utf8");

const app = createApp(
  seedDatabase(path.resolve("data", "rental-payment-methods-smoke.db")).dbPath
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

const house = app.call(
  "house.create",
  {
    title: "字典收租房",
    deal_type: "rent",
    community: "收租苑",
    price: 3500,
    owner_name: "业主",
    owner_phone: "13770001001",
    status: "available",
  },
  agent
);
assert(house.ok, "create rent house");
const houseId = data<any>(house).id;

const property = app.call(
  "rental.properties.create",
  {
    house_id: houseId,
    management_type: "rent_out",
    manager_user_id: agentId,
    start_date: "2026-01-01",
    end_date: "2027-12-31",
    owner_payment: 2500,
  },
  manager
);
assert(property.ok, "create managed property");
const propertyId = data<any>(property).id;
assert(
  app.call(
    "attachment.add",
    {
      parent_type: "rental_property",
      parent_id: propertyId,
      category: "management_contract",
      name: "托管合同.txt",
      local_path: fixture,
    },
    manager
  ).ok,
  "upload management contract"
);
assert(app.call("rental.properties.activate", { id: propertyId }, manager).ok, "activate property");

const lease = app.call(
  "rental.leases.create",
  {
    property_id: propertyId,
    tenant_name: "字典租客",
    tenant_phone: "13770002001",
    start_date: "2026-06-01",
    end_date: "2027-05-31",
    monthly_rent: 3500,
    deposit_amount: 3500,
    payment_cycle_months: 1,
    first_due_date: "2026-06-01",
  },
  manager
);
assert(lease.ok, "create lease");
const leaseId = data<any>(lease).id;
assert(
  app.call(
    "attachment.add",
    {
      parent_type: "rental_lease",
      parent_id: leaseId,
      category: "signed_lease",
      name: "已签租约.txt",
      local_path: fixture,
    },
    manager
  ).ok,
  "upload signed lease"
);
assert(app.call("rental.leases.activate", { id: leaseId }, manager).ok, "activate lease");

const bills = data<any[]>(app.call("rental.bills.list", { lease_id: leaseId }, finance));
assert(bills.length >= 2, "lease generates bills");
const firstBill = bills[0];
const secondBill = bills[1];

assert(
  !app.call(
    "rental.bills.pay",
    {
      id: firstBill.id,
      paid_amount: firstBill.amount,
      payment_method: "carrier_pigeon",
      payment_reference: "X",
    },
    finance
  ).ok,
  "reject unknown rental payment method"
);

assert(
  !app.call(
    "rental.bills.pay",
    {
      id: firstBill.id,
      paid_amount: firstBill.amount,
      payment_method: "bank",
      payment_reference: "",
    },
    finance
  ).ok,
  "non-cash rental payment requires reference"
);

assert(
  app.call(
    "rental.bills.pay",
    {
      id: firstBill.id,
      paid_amount: firstBill.amount,
      payment_method: "bank",
      payment_reference: "RENT-DICT-001",
    },
    finance
  ).ok,
  "accept bank alias for rental pay"
);

const paidFirst = data<any[]>(
  app.call("rental.bills.list", { lease_id: leaseId, status: "paid" }, finance)
).find((row) => row.id === firstBill.id);
assert(paidFirst?.payment_method === "transfer", "bank normalized to transfer");
assert(paidFirst?.payment_method_label === "转账", "paid bill shows transfer label");

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

assert(
  !app.call(
    "rental.bills.pay",
    {
      id: secondBill.id,
      paid_amount: secondBill.amount,
      payment_method: "wechat",
      payment_reference: "WX-1",
    },
    finance
  ).ok,
  "default wechat rejected after custom dict override"
);

assert(
  app.call(
    "rental.bills.pay",
    {
      id: secondBill.id,
      paid_amount: secondBill.amount,
      payment_method: "pos",
      payment_reference: "POS-RENT-1",
    },
    finance
  ).ok,
  "rental pay with custom method"
);

const paidSecond = data<any[]>(
  app.call("rental.bills.list", { lease_id: leaseId, status: "paid" }, finance)
).find((row) => row.id === secondBill.id);
assert(paidSecond?.payment_method === "pos", "custom method stored");
assert(paidSecond?.payment_method_label === "POS刷卡", "custom method label");

console.log(`Rental payment methods smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
