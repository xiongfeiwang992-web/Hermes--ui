import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "rental-lease-create-notify-smoke.db")).dbPath
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
const createMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "rental" && m.title === "租约草稿已登记"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

let phoneSeq = 200;
const fixture = path.resolve("data", "rental-lease-create-notify-fixture.txt");
fs.writeFileSync(fixture, "management contract", "utf8");

function prepareProperty(title: string, managerUserId: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "rent",
      community: "租约登记小区",
      price: 3.5,
      owner_name: "登记业主",
      owner_phone: `1374${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    agent
  );
  assert(house.ok, `create ${title}`);
  const property = app.call(
    "rental.properties.create",
    {
      house_id: data<any>(house).id,
      management_type: "rent_out",
      manager_user_id: managerUserId,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      owner_payment: 2500,
    },
    manager
  );
  assert(property.ok, `create property ${title}`);
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
    `upload ${title}`
  );
  assert(
    app.call("rental.properties.activate", { id: propertyId }, manager).ok,
    `activate ${title}`
  );
  return propertyId;
}

const propertyId = prepareProperty("租约登记通知盘", agentId);
const beforeAgent = createMsgs(agent).length;
const beforeManager = createMsgs(manager).length;
const lease = app.call(
  "rental.leases.create",
  {
    property_id: propertyId,
    tenant_name: "登记租客甲",
    tenant_phone: "13882000001",
    start_date: "2026-06-01",
    end_date: "2027-05-31",
    monthly_rent: 3500,
    deposit_amount: 3500,
    payment_cycle_months: 1,
    first_due_date: "2026-06-01",
  },
  manager
);
assert(lease.ok, "manager creates lease");
assert(data<any>(lease).status === "draft", "status draft");
assert(createMsgs(agent).length === beforeAgent + 1, "property manager receives message");
assert(createMsgs(manager).length === beforeManager, "creator does not self-notify");
assert(
  createMsgs(agent).some(
    (m) =>
      m.ref_id === data<any>(lease).id &&
      String(m.body).includes("租约登记通知盘") &&
      String(m.body).includes("登记租客甲")
  ),
  "create message body"
);

const selfProperty = prepareProperty("自行负责租约登记盘", managerId);
const beforeSelf = createMsgs(manager).length;
assert(
  app.call(
    "rental.leases.create",
    {
      property_id: selfProperty,
      tenant_name: "登记租客乙",
      tenant_phone: "13882000002",
      start_date: "2026-06-01",
      end_date: "2027-05-31",
      monthly_rent: 3600,
      deposit_amount: 3600,
      payment_cycle_months: 1,
      first_due_date: "2026-06-01",
    },
    manager
  ).ok,
  "create lease on self-managed property"
);
assert(createMsgs(manager).length === beforeSelf, "self-managed skips notify");

const mutedProperty = prepareProperty("静音租约登记盘", peerId);
assert(
  app.call("message.subscriptions.save", { channels: { rental: false } }, peer).ok,
  "mute rental"
);
const beforeMute = createMsgs(peer).length;
assert(
  app.call(
    "rental.leases.create",
    {
      property_id: mutedProperty,
      tenant_name: "登记租客丙",
      tenant_phone: "13882000003",
      start_date: "2026-06-01",
      end_date: "2027-05-31",
      monthly_rent: 3700,
      deposit_amount: 3700,
      payment_cycle_months: 1,
      first_due_date: "2026-06-01",
    },
    manager
  ).ok,
  "create while muted"
);
assert(createMsgs(peer).length === beforeMute, "muted rental suppresses create message");

console.log(
  `Rental lease create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
