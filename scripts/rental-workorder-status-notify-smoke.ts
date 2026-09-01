import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "rental-workorder-status-notify-smoke.db")).dbPath
);
const fixture = path.resolve("data", "rental-workorder-status-notify-fixture.txt");
fs.writeFileSync(fixture, "work order evidence", "utf8");

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
const msgs = (token: string, title: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "rental" && m.title === title
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

let phoneSeq = 800;
function createRentHouse(title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "rent",
      community: "工单状态小区",
      price: 2.8,
      owner_name: "工单业主",
      owner_phone: `1355${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    agent
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

function prepareActiveProperty(title: string, managerUserId: string) {
  const houseId = createRentHouse(title);
  const property = app.call(
    "rental.properties.create",
    {
      house_id: houseId,
      management_type: "rent_out",
      manager_user_id: managerUserId,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      owner_payment: 2200,
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
    `upload contract ${title}`
  );
  assert(
    app.call("rental.properties.activate", { id: propertyId }, manager).ok,
    `activate ${title}`
  );
  return propertyId;
}

const propertyId = prepareActiveProperty("工单状态通知盘", agentId);
const work = app.call(
  "rental.workOrders.create",
  {
    property_id: propertyId,
    work_type: "cleaning",
    description: "深度保洁通知",
    assignee_user_id: peerId,
    expected_cost: 260,
  },
  manager
);
assert(work.ok, "manager creates cleaning work order");
const workId = data<any>(work).id;

const beforeStartManager = msgs(manager, "保洁工单已开始").length;
const beforeStartAgent = msgs(agent, "保洁工单已开始").length;
const beforeStartPeer = msgs(peer, "保洁工单已开始").length;
assert(
  app.call("rental.workOrders.status", { id: workId, status: "in_progress" }, peer).ok,
  "assignee starts work order"
);
assert(msgs(manager, "保洁工单已开始").length === beforeStartManager + 1, "creator receives start");
assert(msgs(agent, "保洁工单已开始").length === beforeStartAgent + 1, "property manager receives start");
assert(msgs(peer, "保洁工单已开始").length === beforeStartPeer, "starter does not self-notify");

assert(
  !app.call(
    "rental.workOrders.status",
    {
      id: workId,
      status: "completed",
      actual_cost: 250,
      completion_note: "完成",
    },
    peer
  ).ok,
  "complete requires evidence"
);
assert(
  app.call(
    "attachment.add",
    {
      parent_type: "rental_work_order",
      parent_id: workId,
      category: "work_order_evidence",
      name: "完工.txt",
      local_path: fixture,
    },
    peer
  ).ok,
  "upload evidence"
);

const beforeDoneManager = msgs(manager, "保洁工单已完成").length;
const beforeDoneAgent = msgs(agent, "保洁工单已完成").length;
assert(
  app.call(
    "rental.workOrders.status",
    {
      id: workId,
      status: "completed",
      actual_cost: 250,
      completion_note: "保洁完成验收",
    },
    peer
  ).ok,
  "assignee completes work order"
);
assert(msgs(manager, "保洁工单已完成").length === beforeDoneManager + 1, "creator receives complete");
assert(msgs(agent, "保洁工单已完成").length === beforeDoneAgent + 1, "property manager receives complete");
assert(
  msgs(manager, "保洁工单已完成").some(
    (m) =>
      m.ref_id === workId &&
      String(m.body).includes("深度保洁通知") &&
      String(m.body).includes("250") &&
      String(m.body).includes("保洁完成验收")
  ),
  "complete message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { rental: false } }, manager).ok,
  "mute rental"
);
const mutedProperty = prepareActiveProperty("静音工单状态盘", agentId);
const mutedWork = app.call(
  "rental.workOrders.create",
  {
    property_id: mutedProperty,
    work_type: "maintenance",
    description: "静音维修",
    assignee_user_id: peerId,
    expected_cost: 100,
  },
  manager
);
assert(mutedWork.ok, "create muted work order");
const mutedId = data<any>(mutedWork).id;
const beforeMute = msgs(manager, "维修工单已开始").length;
assert(
  app.call("rental.workOrders.status", { id: mutedId, status: "in_progress" }, peer).ok,
  "start while muted"
);
assert(msgs(manager, "维修工单已开始").length === beforeMute, "muted rental suppresses start");

console.log(
  `Rental workorder status notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
