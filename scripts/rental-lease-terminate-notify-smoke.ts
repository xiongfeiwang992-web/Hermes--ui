import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "rental-lease-terminate-notify-smoke.db")).dbPath
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
const terminateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "rental" && m.title === "租约已终止"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

let phoneSeq = 800;
const fixture = path.resolve("data", "rental-lease-terminate-notify-fixture.txt");
fs.writeFileSync(fixture, "lease and contract", "utf8");

function prepareActiveLease(opts: {
  title: string;
  managerUserId: string;
  tenantName: string;
  tenantPhone: string;
}) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title: opts.title,
      deal_type: "rent",
      community: "租约终止小区",
      price: 3.5,
      owner_name: "租约业主",
      owner_phone: `1375${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    agent
  );
  assert(house.ok, `create ${opts.title}`);
  const property = app.call(
    "rental.properties.create",
    {
      house_id: data<any>(house).id,
      management_type: "rent_out",
      manager_user_id: opts.managerUserId,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      owner_payment: 2500,
    },
    manager
  );
  assert(property.ok, `create property ${opts.title}`);
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
    `upload property contract ${opts.title}`
  );
  assert(
    app.call("rental.properties.activate", { id: propertyId }, manager).ok,
    `activate property ${opts.title}`
  );
  const lease = app.call(
    "rental.leases.create",
    {
      property_id: propertyId,
      tenant_name: opts.tenantName,
      tenant_phone: opts.tenantPhone,
      start_date: "2026-06-01",
      end_date: "2027-05-31",
      monthly_rent: 3500,
      deposit_amount: 3500,
      payment_cycle_months: 1,
      first_due_date: "2026-06-01",
    },
    manager
  );
  assert(lease.ok, `create lease ${opts.title}`);
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
    `upload lease ${opts.title}`
  );
  assert(
    app.call("rental.leases.activate", { id: leaseId }, manager).ok,
    `activate lease ${opts.title}`
  );
  return leaseId;
}

const leaseId = prepareActiveLease({
  title: "租约终止通知盘",
  managerUserId: agentId,
  tenantName: "终止租客甲",
  tenantPhone: "13881000001",
});
assert(
  !app.call("rental.leases.terminate", { id: leaseId, reason: "" }, manager).ok,
  "terminate requires reason"
);
const beforeAgent = terminateMsgs(agent).length;
const beforeManager = terminateMsgs(manager).length;
const terminated = app.call(
  "rental.leases.terminate",
  { id: leaseId, reason: "提前退租" },
  manager
);
assert(terminated.ok, "manager terminates lease");
assert(data<any>(terminated).status === "terminated", "status terminated");
assert(terminateMsgs(agent).length === beforeAgent + 1, "property manager receives message");
assert(terminateMsgs(manager).length === beforeManager, "terminator does not self-notify");
assert(
  terminateMsgs(agent).some(
    (m) =>
      m.ref_id === leaseId &&
      String(m.body).includes("终止租客甲") &&
      String(m.body).includes("提前退租")
  ),
  "terminate message body"
);
assert(
  !app.call("rental.leases.terminate", { id: leaseId, reason: "再次终止" }, manager).ok,
  "cannot terminate twice"
);

const selfLease = prepareActiveLease({
  title: "自行负责租约终止盘",
  managerUserId: managerId,
  tenantName: "终止租客乙",
  tenantPhone: "13881000002",
});
const beforeSelf = terminateMsgs(manager).length;
assert(
  app.call(
    "rental.leases.terminate",
    { id: selfLease, reason: "自行终止" },
    manager
  ).ok,
  "terminate self-managed lease"
);
assert(terminateMsgs(manager).length === beforeSelf, "self-managed skips notify");

const mutedLease = prepareActiveLease({
  title: "静音租约终止盘",
  managerUserId: peerId,
  tenantName: "终止租客丙",
  tenantPhone: "13881000003",
});
assert(
  app.call("message.subscriptions.save", { channels: { rental: false } }, peer).ok,
  "mute rental"
);
const beforeMute = terminateMsgs(peer).length;
assert(
  app.call(
    "rental.leases.terminate",
    { id: mutedLease, reason: "静音终止" },
    manager
  ).ok,
  "terminate while muted"
);
assert(terminateMsgs(peer).length === beforeMute, "muted rental suppresses terminate message");

console.log(
  `Rental lease terminate notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
