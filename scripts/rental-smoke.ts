import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "rental-smoke.db"));
const app = createApp(seeded.dbPath);
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
const finance = login("finance");
const agentC = login("agent_c");
const agentAUser = data<any>(app.call("auth.me", {}, agentA));
const agentBUser = data<any>(app.call("auth.me", {}, agentB));

check(
  data<any>(app.call("rental.options", {}, manager)).stores.length === 1,
  "manager rental options restricted to own store"
);
check(
  data<any>(app.call("rental.options", {}, admin)).stores.length === 2,
  "admin rental options contain company stores"
);
check(
  data<any>(app.call("rental.options", {}, finance)).houses.length === 0,
  "finance receives no rental management write options"
);
const house = app.call(
  "house.create",
  {
    title: "湖畔花园托管两居",
    deal_type: "rent",
    community: "湖畔花园",
    address: "一号楼 101",
    price: 3500,
    owner_name: "王业主",
    owner_phone: "13780000001",
    status: "available",
  },
  agentA
);
check(house.ok, "create rental house");
const houseId = data<any>(house).id;
check(
  !app.call(
    "rental.properties.create",
    {
      house_id: houseId,
      management_type: "rent_out",
      manager_user_id: agentAUser.id,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      owner_payment: 2500,
    },
    agentA
  ).ok,
  "agent cannot register managed property"
);
check(
  !app.call(
    "rental.properties.create",
    {
      house_id: houseId,
      management_type: "invalid",
      manager_user_id: agentAUser.id,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      owner_payment: 2500,
    },
    manager
  ).ok,
  "managed property type validated"
);
check(
  !app.call(
    "rental.properties.create",
    {
      house_id: houseId,
      management_type: "rent_out",
      manager_user_id: agentAUser.id,
      start_date: "2027-01-01",
      end_date: "2026-01-01",
      owner_payment: 2500,
    },
    manager
  ).ok,
  "managed property date range validated"
);
const property = app.call(
  "rental.properties.create",
  {
    house_id: houseId,
    management_type: "rent_out",
    manager_user_id: agentAUser.id,
    start_date: "2026-01-01",
    end_date: "2027-12-31",
    owner_payment: 2500,
  },
  manager
);
check(
  property.ok && data<any>(property).status === "draft",
  "manager creates managed property draft"
);
const propertyId = data<any>(property).id;
check(
  !app.call(
    "rental.properties.create",
    {
      house_id: houseId,
      management_type: "centralized",
      manager_user_id: agentAUser.id,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      owner_payment: 2000,
    },
    admin
  ).ok,
  "house can only have one managed property record"
);
check(
  data<any[]>(app.call("rental.properties.list", {}, agentA)).some(
    (item) => item.id === propertyId
  ),
  "assigned manager sees managed property draft"
);
check(
  !data<any[]>(app.call("rental.properties.list", {}, agentB)).some(
    (item) => item.id === propertyId
  ),
  "unassigned agent cannot see managed property"
);
check(
  data<any[]>(app.call("rental.properties.list", {}, finance)).some(
    (item) => item.id === propertyId
  ),
  "finance can read company managed properties"
);
check(
  !app.call("rental.properties.activate", { id: propertyId }, manager).ok,
  "managed property activation requires contract attachment"
);
const fixture = path.resolve("data", "rental-fixture.txt");
fs.writeFileSync(fixture, "rental contract and work evidence", "utf8");
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "rental_property",
      parent_id: propertyId,
      category: "invalid",
      name: "错误附件.txt",
      local_path: fixture,
    },
    manager
  ).ok,
  "managed property attachment category validated"
);
check(
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
  "manager uploads management contract"
);
check(
  app.call("rental.properties.activate", { id: propertyId }, manager).ok,
  "manager activates managed property"
);
check(
  !app.call("rental.properties.activate", { id: propertyId }, manager).ok,
  "active managed property cannot activate twice"
);

check(
  !app.call(
    "rental.leases.create",
    {
      property_id: propertyId,
      tenant_name: "李租客",
      tenant_phone: "123",
      start_date: "2026-06-01",
      end_date: "2027-05-31",
      monthly_rent: 3500,
      deposit_amount: 3500,
      payment_cycle_months: 1,
      first_due_date: "2026-06-01",
    },
    manager
  ).ok,
  "tenant phone validated"
);
check(
  !app.call(
    "rental.leases.create",
    {
      property_id: propertyId,
      tenant_name: "李租客",
      tenant_phone: "13880000001",
      start_date: "2026-06-01",
      end_date: "2027-05-31",
      monthly_rent: 3500,
      deposit_amount: 3500,
      payment_cycle_months: 5,
      first_due_date: "2026-06-01",
    },
    manager
  ).ok,
  "lease payment cycle validated"
);
check(
  !app.call(
    "rental.leases.create",
    {
      property_id: propertyId,
      tenant_name: "李租客",
      tenant_phone: "13880000001",
      start_date: "2025-06-01",
      end_date: "2027-05-31",
      monthly_rent: 3500,
      deposit_amount: 3500,
      payment_cycle_months: 1,
      first_due_date: "2025-06-01",
    },
    manager
  ).ok,
  "lease must remain within management term"
);
const lease = app.call(
  "rental.leases.create",
  {
    property_id: propertyId,
    tenant_name: "李租客",
    tenant_phone: "13880000001",
    start_date: "2026-06-01",
    end_date: "2027-05-31",
    monthly_rent: 3500,
    deposit_amount: 3500,
    payment_cycle_months: 1,
    first_due_date: "2026-06-01",
  },
  manager
);
check(lease.ok && data<any>(lease).status === "draft", "manager creates lease draft");
const leaseId = data<any>(lease).id;
check(
  !app.call(
    "rental.leases.create",
    {
      property_id: propertyId,
      tenant_name: "重叠租客",
      tenant_phone: "13880000002",
      start_date: "2026-07-01",
      end_date: "2026-12-31",
      monthly_rent: 3600,
      deposit_amount: 3600,
      payment_cycle_months: 1,
      first_due_date: "2026-07-01",
    },
    manager
  ).ok,
  "overlapping lease rejected"
);
check(
  !app.call("rental.leases.activate", { id: leaseId }, manager).ok,
  "lease activation requires signed attachment"
);
check(
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
  "manager uploads signed lease"
);
check(
  app.call("rental.leases.activate", { id: leaseId }, manager).ok,
  "manager activates signed lease"
);
const bills = app.call("rental.bills.list", { lease_id: leaseId }, manager);
check(
  bills.ok &&
    data<any[]>(bills).length === 12 &&
    data<any[]>(bills).every((bill) => bill.amount === 3500),
  "lease activation generates twelve monthly bills"
);
check(
  data<any[]>(bills)[0].status === "overdue",
  "past-due pending bill refreshes to overdue"
);
check(
  data<any[]>(app.call("rental.bills.list", {}, agentA)).length === 12,
  "assigned manager sees rental bills"
);
check(
  data<any[]>(app.call("rental.bills.list", {}, agentC)).length === 0,
  "other-store agent cannot see rental bills"
);
const firstBill = data<any[]>(bills)[0];
check(
  !app.call(
    "rental.bills.pay",
    {
      id: firstBill.id,
      paid_amount: 3500,
      payment_method: "bank",
      payment_reference: "RENT-001",
    },
    manager
  ).ok,
  "manager cannot confirm rental payment"
);
check(
  !app.call(
    "rental.bills.pay",
    {
      id: firstBill.id,
      paid_amount: 3000,
      payment_method: "cash",
    },
    finance
  ).ok,
  "rental bill requires full payment"
);
check(
  !app.call(
    "rental.bills.pay",
    {
      id: firstBill.id,
      paid_amount: 3500,
      payment_method: "bank",
      payment_reference: "",
    },
    finance
  ).ok,
  "bank rental payment requires reference"
);
check(
  app.call(
    "rental.bills.pay",
    {
      id: firstBill.id,
      paid_amount: 3500,
      payment_method: "bank",
      payment_reference: "RENT-001",
    },
    finance
  ).ok,
  "finance confirms full rental payment"
);
check(
  !app.call(
    "rental.bills.pay",
    {
      id: firstBill.id,
      paid_amount: 3500,
      payment_method: "bank",
      payment_reference: "RENT-002",
    },
    finance
  ).ok,
  "paid rental bill is immutable"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.ref_id === firstBill.id && message.kind === "rental"
  ),
  "property manager receives rent payment message"
);
const secondBill = data<any[]>(bills)[1];
check(
  !app.call("rental.bills.void", { id: secondBill.id, reason: "测试" }, finance).ok,
  "only admin can void rental bill"
);
check(
  !app.call("rental.bills.void", { id: secondBill.id, reason: "" }, admin).ok,
  "rental bill void requires reason"
);
check(
  app.call("rental.bills.void", { id: secondBill.id, reason: "账期调整" }, admin).ok,
  "admin voids unpaid rental bill with reason"
);

check(
  !app.call(
    "rental.workOrders.create",
    {
      property_id: propertyId,
      work_type: "invalid",
      description: "故障",
      expected_cost: 100,
    },
    agentA
  ).ok,
  "rental work order type validated"
);
const ownWorkOrder = app.call(
  "rental.workOrders.create",
  {
    property_id: propertyId,
    lease_id: leaseId,
    work_type: "maintenance",
    description: "厨房水龙头漏水",
    assignee_user_id: agentBUser.id,
    expected_cost: 180,
  },
  agentA
);
check(ownWorkOrder.ok, "assigned property manager creates maintenance order");
const ownWorkOrderId = data<any>(ownWorkOrder).id;
const ownWork = data<any[]>(app.call("rental.workOrders.list", {}, agentA)).find(
  (item) => item.id === ownWorkOrderId
);
check(
  ownWork?.assignee_user_id === agentAUser.id,
  "agent-created work order is assigned to self"
);
const assignedWorkOrder = app.call(
  "rental.workOrders.create",
  {
    property_id: propertyId,
    lease_id: leaseId,
    work_type: "cleaning",
    description: "租后深度保洁",
    assignee_user_id: agentBUser.id,
    expected_cost: 300,
  },
  manager
);
check(assignedWorkOrder.ok, "manager assigns cleaning work order");
const assignedWorkOrderId = data<any>(assignedWorkOrder).id;
check(
  data<any[]>(app.call("rental.workOrders.list", {}, agentB)).some(
    (item) => item.id === assignedWorkOrderId
  ),
  "work-order assignee sees assigned work"
);
check(
  data<any[]>(app.call("message.list", {}, agentB)).some(
    (message) => message.ref_id === assignedWorkOrderId
  ),
  "work-order assignee receives message"
);
check(
  app.call(
    "rental.workOrders.status",
    { id: assignedWorkOrderId, status: "in_progress" },
    agentB
  ).ok,
  "assignee starts work order"
);
check(
  !app.call(
    "rental.workOrders.status",
    {
      id: assignedWorkOrderId,
      status: "completed",
      actual_cost: 280,
      completion_note: "保洁完成",
    },
    agentB
  ).ok,
  "work order completion requires evidence"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "rental_work_order",
      parent_id: assignedWorkOrderId,
      category: "work_order_evidence",
      name: "完工照片.txt",
      local_path: fixture,
    },
    agentB
  ).ok,
  "assignee uploads work-order evidence"
);
check(
  app.call(
    "rental.workOrders.status",
    {
      id: assignedWorkOrderId,
      status: "completed",
      actual_cost: 280,
      completion_note: "保洁完成",
    },
    agentB
  ).ok,
  "assignee completes evidenced work order"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "rental_work_order",
      parent_id: assignedWorkOrderId,
      category: "work_order_evidence",
      name: "追加照片.txt",
      local_path: fixture,
    },
    agentB
  ).ok,
  "completed work order rejects new evidence"
);
check(
  !app.call("rental.workOrders.cancel", { id: ownWorkOrderId, reason: "" }, manager).ok,
  "work order cancellation requires reason"
);
check(
  app.call(
    "rental.workOrders.cancel",
    { id: ownWorkOrderId, reason: "租客自行处理" },
    manager
  ).ok,
  "manager cancels open work order"
);

check(
  !app.call("rental.leases.terminate", { id: leaseId, reason: "" }, manager).ok,
  "lease termination requires reason"
);
check(
  !app.call("rental.properties.terminate", { id: propertyId, reason: "结束托管" }, manager)
    .ok,
  "managed property cannot terminate with active lease"
);
check(
  app.call(
    "rental.leases.terminate",
    { id: leaseId, reason: "双方协商退租" },
    manager
  ).ok,
  "manager terminates active lease"
);
const billsAfterTermination = data<any[]>(
  app.call("rental.bills.list", { lease_id: leaseId }, admin)
);
check(
  billsAfterTermination.filter((bill) => bill.status === "paid").length === 1 &&
    billsAfterTermination.filter((bill) => bill.status === "voided").length === 11,
  "lease termination retains paid bill and voids all unpaid bills"
);
check(
  app.call(
    "rental.properties.terminate",
    { id: propertyId, reason: "托管合同到期前解除" },
    manager
  ).ok,
  "manager terminates managed property after lease closure"
);
check(
  !app.call(
    "rental.workOrders.create",
    {
      property_id: propertyId,
      work_type: "maintenance",
      description: "终止后工单",
      expected_cost: 0,
    },
    agentA
  ).ok,
  "terminated property rejects new work order"
);
const leaseEvents = app.call(
  "rental.events",
  { entity_type: "lease", entity_id: leaseId },
  agentA
);
check(
  leaseEvents.ok &&
    data<any[]>(leaseEvents).some((event) => event.event_type === "activated") &&
    data<any[]>(leaseEvents).some((event) => event.event_type === "terminated"),
  "lease lifecycle event history is visible to assigned manager"
);
check(
  !app.call(
    "rental.events",
    { entity_type: "lease", entity_id: leaseId },
    agentC
  ).ok,
  "out-of-scope employee cannot inspect rental events"
);
for (const type of ["managed_property", "lease", "bill", "maintenance", "cleaning"]) {
  check(
    !app.call(
      "suite.create",
      {
        module: "rental",
        record_type: type,
        title: `通用${type}`,
        data: {},
      },
      manager
    ).ok,
    `generic rental type ${type} disabled`
  );
}
const audits = data<any[]>(
  app.call("audit.list", { entity_type: "rental_lease" }, admin)
);
check(
  audits.some((item) => item.action === "rental.lease.activate") &&
    audits.some((item) => item.action === "rental.lease.terminate"),
  "rental lease lifecycle writes audit logs"
);

console.log(`Rental smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
