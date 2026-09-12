import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "rental-workorder-cancel-notify-smoke.db"));
const app = createApp(seeded.dbPath);
const fixture = path.resolve("/tmp", "rental-workorder-cancel-notify.txt");
fs.writeFileSync(fixture, "rental workorder cancel notify fixture");

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
const cancelMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "rental" &&
      (m.title === "维修工单已取消" || m.title === "保洁工单已取消")
  );

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAUser = data<any>(app.call("auth.me", {}, agentA));
const agentBUser = data<any>(app.call("auth.me", {}, agentB));

const house = app.call(
  "house.create",
  {
    title: "工单取消通知托管房",
    deal_type: "rent",
    community: "取消通知小区",
    address: "二号楼 201",
    price: 3200,
    owner_name: "业主取消测",
    owner_phone: "13780000991",
    status: "available",
  },
  agentA
);
assert(house.ok, "create rental house");

const property = app.call(
  "rental.properties.create",
  {
    house_id: data<any>(house).id,
    management_type: "rent_out",
    manager_user_id: agentAUser.id,
    start_date: "2026-01-01",
    end_date: "2027-12-31",
    owner_payment: 2400,
  },
  manager
);
assert(property.ok && data<any>(property).status === "draft", "create managed property");
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
assert(
  app.call("rental.properties.activate", { id: propertyId }, manager).ok,
  "activate managed property"
);

const workOrder = app.call(
  "rental.workOrders.create",
  {
    property_id: propertyId,
    work_type: "maintenance",
    description: "卫生间水管渗漏",
    assignee_user_id: agentBUser.id,
    expected_cost: 220,
  },
  manager
);
assert(workOrder.ok, "manager creates assigned maintenance order");
const workOrderId = data<any>(workOrder).id;

assert(
  !app.call("rental.workOrders.cancel", { id: workOrderId, reason: "租客自行处理" }, agentB)
    .ok,
  "assignee cannot cancel work order"
);

const beforeAssignee = cancelMsgs(agentB).length;
const beforeManager = cancelMsgs(manager).length;
const cancelled = app.call(
  "rental.workOrders.cancel",
  { id: workOrderId, reason: "租客自行处理" },
  manager
);
assert(cancelled.ok, "manager cancels work order");
assert(data<any>(cancelled).status === "cancelled", "status cancelled");

const afterAssignee = cancelMsgs(agentB);
assert(afterAssignee.length === beforeAssignee + 1, "assignee receives cancel message");
assert(afterAssignee[0].ref_id === workOrderId, "message refs work order");
assert(afterAssignee[0].title === "维修工单已取消", "maintenance cancel title");
assert(String(afterAssignee[0].body).includes("卫生间水管渗漏"), "body has description");
assert(String(afterAssignee[0].body).includes("租客自行处理"), "body has reason");
assert(cancelMsgs(manager).length === beforeManager, "canceller does not self-notify");
assert(
  !app.call(
    "rental.workOrders.cancel",
    { id: workOrderId, reason: "再次取消" },
    manager
  ).ok,
  "cannot cancel twice"
);

const cleaning = app.call(
  "rental.workOrders.create",
  {
    property_id: propertyId,
    work_type: "cleaning",
    description: "退房深度保洁",
    assignee_user_id: agentBUser.id,
    expected_cost: 260,
  },
  manager
);
assert(cleaning.ok, "create cleaning work order");
const cleaningId = data<any>(cleaning).id;
assert(
  app.call("message.subscriptions.save", { channels: { rental: false } }, agentB).ok,
  "mute rental channel"
);
const beforeMute = cancelMsgs(agentB).length;
assert(
  app.call(
    "rental.workOrders.cancel",
    { id: cleaningId, reason: "档期冲突取消" },
    manager
  ).ok,
  "cancel cleaning while assignee muted"
);
assert(cancelMsgs(agentB).length === beforeMute, "muted rental suppresses cancel message");

console.log(
  `Rental workorder cancel notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
