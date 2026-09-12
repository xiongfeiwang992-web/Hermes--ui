import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "rental-terminate-notify-smoke.db")).dbPath
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
    (m) => m.kind === "rental" && m.title === "托管物业已终止"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

let phoneSeq = 700;
const fixture = path.resolve("data", "rental-terminate-notify-fixture.txt");
fs.writeFileSync(fixture, "management contract", "utf8");

function prepareActive(title: string, managerUserId: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "rent",
      community: "托管终止小区",
      price: 3.2,
      owner_name: "终止业主",
      owner_phone: `1377${String(phoneSeq).padStart(7, "0")}`,
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
    `upload ${title}`
  );
  assert(
    app.call("rental.properties.activate", { id: propertyId }, manager).ok,
    `activate ${title}`
  );
  return propertyId;
}

const propertyId = prepareActive("托管终止通知盘", agentId);
assert(
  !app.call("rental.properties.terminate", { id: propertyId, reason: "" }, manager).ok,
  "terminate requires reason"
);
const beforeAgent = terminateMsgs(agent).length;
const beforeManager = terminateMsgs(manager).length;
const terminated = app.call(
  "rental.properties.terminate",
  { id: propertyId, reason: "合同到期结束" },
  manager
);
assert(terminated.ok, "manager terminates property");
assert(data<any>(terminated).status === "terminated", "status terminated");
assert(terminateMsgs(agent).length === beforeAgent + 1, "property manager receives message");
assert(terminateMsgs(manager).length === beforeManager, "terminator does not self-notify");
assert(
  terminateMsgs(agent).some(
    (m) =>
      m.ref_id === propertyId &&
      String(m.body).includes("托管终止通知盘") &&
      String(m.body).includes("合同到期结束")
  ),
  "terminate message body"
);
assert(
  !app.call(
    "rental.properties.terminate",
    { id: propertyId, reason: "再次终止" },
    manager
  ).ok,
  "cannot terminate twice"
);

const selfId = prepareActive("自行负责终止盘", managerId);
const beforeSelf = terminateMsgs(manager).length;
assert(
  app.call(
    "rental.properties.terminate",
    { id: selfId, reason: "自行终止" },
    manager
  ).ok,
  "terminate self-managed"
);
assert(terminateMsgs(manager).length === beforeSelf, "self-managed skips notify");

const mutedId = prepareActive("静音终止托管盘", peerId);
assert(
  app.call("message.subscriptions.save", { channels: { rental: false } }, peer).ok,
  "mute rental"
);
const beforeMute = terminateMsgs(peer).length;
assert(
  app.call(
    "rental.properties.terminate",
    { id: mutedId, reason: "静音终止" },
    manager
  ).ok,
  "terminate while muted"
);
assert(terminateMsgs(peer).length === beforeMute, "muted rental suppresses terminate message");

console.log(`Rental terminate notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
