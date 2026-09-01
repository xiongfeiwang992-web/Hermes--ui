import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "rental-activate-notify-smoke.db")).dbPath
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
const activateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "rental" && m.title === "托管物业已启用"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

let phoneSeq = 600;
function createRentHouse(title: string, byToken: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "rent",
      community: "托管启用小区",
      price: 3.5,
      owner_name: "托管业主",
      owner_phone: `1376${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    byToken
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

const fixture = path.resolve("data", "rental-activate-notify-fixture.txt");
fs.writeFileSync(fixture, "management contract", "utf8");

function prepareDraft(title: string, managerUserId: string) {
  const houseId = createRentHouse(title, agent);
  const property = app.call(
    "rental.properties.create",
    {
      house_id: houseId,
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
    `upload contract ${title}`
  );
  return propertyId;
}

const propertyId = prepareDraft("托管启用通知盘", agentId);
assert(
  !app.call("rental.properties.activate", { id: propertyId }, agent).ok,
  "agent cannot activate property"
);

const beforeAgent = activateMsgs(agent).length;
const beforeManager = activateMsgs(manager).length;
const activated = app.call("rental.properties.activate", { id: propertyId }, manager);
assert(activated.ok, "manager activates property");
assert(data<any>(activated).status === "active", "status active");
assert(activateMsgs(agent).length === beforeAgent + 1, "property manager receives message");
assert(activateMsgs(manager).length === beforeManager, "activator does not self-notify");
assert(
  activateMsgs(agent).some(
    (m) =>
      m.ref_id === propertyId && String(m.body).includes("托管启用通知盘")
  ),
  "body has house title"
);
assert(
  !app.call("rental.properties.activate", { id: propertyId }, manager).ok,
  "cannot activate twice"
);

const selfId = prepareDraft("自行负责托管盘", data<any>(app.call("auth.me", {}, manager)).id);
const beforeSelf = activateMsgs(manager).length;
assert(
  app.call("rental.properties.activate", { id: selfId }, manager).ok,
  "manager activates self-managed property"
);
assert(activateMsgs(manager).length === beforeSelf, "self-managed skips notify");

const mutedId = prepareDraft("静音托管启用盘", peerId);
assert(
  app.call("message.subscriptions.save", { channels: { rental: false } }, peer).ok,
  "mute rental"
);
const beforeMute = activateMsgs(peer).length;
assert(
  app.call("rental.properties.activate", { id: mutedId }, manager).ok,
  "activate while muted"
);
assert(activateMsgs(peer).length === beforeMute, "muted rental suppresses activate message");

console.log(`Rental activate notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
