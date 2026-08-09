import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "rental-bill-void-notify-smoke.db")).dbPath
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
const voidMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "rental" && m.title === "租金账单已作废"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentAUser = data<any>(app.call("auth.me", {}, agentA));
const adminUser = data<any>(app.call("auth.me", {}, admin));

const fixture = path.resolve("data", "rental-bill-void-notify-fixture.txt");
fs.writeFileSync(fixture, "rental void notify fixture", "utf8");

function setupLease(managerUserId: string, title: string, phone: string) {
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "rent",
      community: "作废通知小区",
      address: "1-101",
      price: 3000,
      owner_name: "业主",
      owner_phone: phone.replace(/^138/, "137"),
      status: "available",
    },
    agentA
  );
  assert(house.ok, `create house ${title}`);
  const property = app.call(
    "rental.properties.create",
    {
      house_id: data<any>(house).id,
      management_type: "rent_out",
      manager_user_id: managerUserId,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      owner_payment: 2000,
    },
    manager
  );
  assert(property.ok, `create property for ${title}`);
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
    `attach property contract ${title}`
  );
  assert(
    app.call("rental.properties.activate", { id: propertyId }, manager).ok,
    `activate property ${title}`
  );
  const lease = app.call(
    "rental.leases.create",
    {
      property_id: propertyId,
      tenant_name: "作废租客",
      tenant_phone: phone,
      start_date: "2026-06-01",
      end_date: "2027-05-31",
      monthly_rent: 3000,
      deposit_amount: 3000,
      payment_cycle_months: 1,
      first_due_date: "2026-06-01",
    },
    manager
  );
  assert(lease.ok, `create lease ${title}`);
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
    `attach lease ${title}`
  );
  assert(
    app.call("rental.leases.activate", { id: leaseId }, manager).ok,
    `activate lease ${title}`
  );
  const bills = data<any[]>(app.call("rental.bills.list", { lease_id: leaseId }, manager));
  assert(bills.length > 0, `bills generated ${title}`);
  return bills.find((b) => ["pending", "overdue"].includes(b.status)) || bills[0];
}

const bill = setupLease(agentAUser.id, "作废通知盘A", "13890001001");
const beforeA = voidMsgs(agentA).length;
const beforeAdmin = voidMsgs(admin).length;

assert(
  !app.call("rental.bills.void", { id: bill.id, reason: "" }, admin).ok,
  "void requires reason"
);

const voided = app.call(
  "rental.bills.void",
  { id: bill.id, reason: "账期调整" },
  admin
);
assert(voided.ok, "admin voids bill");
assert(data<any>(voided).status === "voided", "status voided");
assert(data<any>(voided).void_reason === "账期调整", "void_reason returned");

const afterA = voidMsgs(agentA);
assert(afterA.length === beforeA + 1, "property manager receives void message");
assert(afterA[0].ref_id === bill.id, "message refs bill");
assert(String(afterA[0].body).includes("作废租客"), "body has tenant");
assert(String(afterA[0].body).includes("账期调整"), "body has reason");
assert(voidMsgs(admin).length === beforeAdmin, "admin actor does not self-notify");

assert(
  !app.call("rental.bills.void", { id: bill.id, reason: "再次" }, admin).ok,
  "cannot void twice"
);

const bill2 = setupLease(agentAUser.id, "作废静音盘", "13890001002");
assert(
  app.call("message.subscriptions.save", { channels: { rental: false } }, agentA).ok,
  "mute rental channel"
);
const beforeMute = voidMsgs(agentA).length;
assert(
  app.call("rental.bills.void", { id: bill2.id, reason: "静音测" }, admin).ok,
  "void while muted"
);
assert(voidMsgs(agentA).length === beforeMute, "muted rental suppresses void message");

const bill3 = setupLease(adminUser.id, "作废自管盘", "13890001003");
const beforeSelf = voidMsgs(admin).length;
assert(
  app.call("rental.bills.void", { id: bill3.id, reason: "自管作废" }, admin).ok,
  "admin voids own managed bill"
);
assert(voidMsgs(admin).length === beforeSelf, "self-managed void skips notify");

console.log(`Rental bill void notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
