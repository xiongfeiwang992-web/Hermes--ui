import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "rental-workorder-create-notify-smoke.db")).dbPath
);
const fixture = path.resolve("data", "rental-workorder-create-notify-fixture.txt");
fs.writeFileSync(fixture, "work order create evidence", "utf8");

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

let phoneSeq = 810;
function createRentHouse(title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "rent",
      community: "工单创建小区",
      price: 2.8,
      owner_name: "工单业主",
      owner_phone: `1356${String(phoneSeq).padStart(7, "0")}`,
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

const houseTitle = "工单创建通知盘";
const propertyId = prepareActiveProperty(houseTitle, agentId);

const beforeCleaningPeer = msgs(peer, "新保洁工单").length;
const beforeCleaningAgent = msgs(agent, "新保洁工单").length;
const beforeCleaningManager = msgs(manager, "新保洁工单").length;

const cleaning = app.call(
  "rental.workOrders.create",
  {
    property_id: propertyId,
    work_type: "cleaning",
    description: "深度保洁创建通知",
    assignee_user_id: peerId,
    expected_cost: 260,
  },
  manager
);
assert(cleaning.ok, "manager creates cleaning work order");
const cleaningId = data<any>(cleaning).id;
assert(
  msgs(peer, "新保洁工单").length === beforeCleaningPeer + 1,
  "assignee receives cleaning create"
);
assert(
  msgs(agent, "新保洁工单").length === beforeCleaningAgent,
  "property manager not notified on create"
);
assert(
  msgs(manager, "新保洁工单").length === beforeCleaningManager,
  "creator skips self on create"
);
assert(
  msgs(peer, "新保洁工单").some(
    (m) =>
      m.ref_id === cleaningId &&
      m.ref_type === "rental_work_order" &&
      String(m.body).includes(houseTitle) &&
      String(m.body).includes("深度保洁创建通知")
  ),
  "cleaning create body includes house and description"
);

const beforeMaintPeer = msgs(peer, "新维修工单").length;
const maintenance = app.call(
  "rental.workOrders.create",
  {
    property_id: propertyId,
    work_type: "maintenance",
    description: "水管维修创建通知",
    assignee_user_id: peerId,
    expected_cost: 180,
  },
  manager
);
assert(maintenance.ok, "manager creates maintenance work order");
assert(
  msgs(peer, "新维修工单").length === beforeMaintPeer + 1,
  "assignee receives maintenance create"
);

const selfAssign = app.call(
  "rental.workOrders.create",
  {
    property_id: propertyId,
    work_type: "cleaning",
    description: "自派不通知",
    assignee_user_id: data<any>(app.call("auth.me", {}, manager)).id,
    expected_cost: 100,
  },
  manager
);
assert(selfAssign.ok, "manager self-assigns work order");
assert(
  msgs(manager, "新保洁工单").length === beforeCleaningManager,
  "self-assign skips create notify"
);

assert(
  app.call("message.subscriptions.save", { channels: { rental: false } }, peer).ok,
  "mute rental"
);
const beforeMute = msgs(peer, "新保洁工单").length;
assert(
  app.call(
    "rental.workOrders.create",
    {
      property_id: propertyId,
      work_type: "cleaning",
      description: "静音创建通知",
      assignee_user_id: peerId,
      expected_cost: 90,
    },
    manager
  ).ok,
  "create while muted"
);
assert(msgs(peer, "新保洁工单").length === beforeMute, "muted rental suppresses create");

console.log(
  `Rental workorder create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
