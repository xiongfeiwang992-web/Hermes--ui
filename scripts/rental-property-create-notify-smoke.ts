import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "rental-property-create-notify-smoke.db")).dbPath
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
    (m) => m.kind === "rental" && m.title === "托管物业已登记"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

let phoneSeq = 700;
function createRentHouse(title: string, byToken: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "rent",
      community: "托管登记小区",
      price: 3.2,
      owner_name: "登记托管业主",
      owner_phone: `1366${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    byToken
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

assert(
  !app.call(
    "rental.properties.create",
    {
      house_id: createRentHouse("无效托管类型盘", agent),
      management_type: "invalid",
      manager_user_id: agentId,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      owner_payment: 2000,
    },
    manager
  ).ok,
  "invalid management type rejected"
);

const houseId = createRentHouse("托管登记通知盘", agent);
const beforeAgent = createMsgs(agent).length;
const beforeManager = createMsgs(manager).length;
const created = app.call(
  "rental.properties.create",
  {
    house_id: houseId,
    management_type: "rent_out",
    manager_user_id: agentId,
    start_date: "2026-01-01",
    end_date: "2027-12-31",
    owner_payment: 2800,
  },
  manager
);
assert(created.ok, "manager creates rental property");
assert(data<any>(created).status === "draft", "status draft");
const propertyId = data<any>(created).id;
assert(createMsgs(agent).length === beforeAgent + 1, "property manager receives create message");
assert(createMsgs(manager).length === beforeManager, "creator does not self-notify");
assert(
  createMsgs(agent).some(
    (m) => m.ref_id === propertyId && String(m.body).includes("托管登记通知盘")
  ),
  "create message body"
);

const selfHouse = createRentHouse("自行负责登记盘", agent);
const beforeSelf = createMsgs(manager).length;
assert(
  app.call(
    "rental.properties.create",
    {
      house_id: selfHouse,
      management_type: "centralized",
      manager_user_id: managerId,
      start_date: "2026-02-01",
      end_date: "2027-02-01",
      owner_payment: 3000,
    },
    manager
  ).ok,
  "manager creates self-managed property"
);
assert(createMsgs(manager).length === beforeSelf, "self-managed create skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { rental: false } }, peer).ok,
  "mute rental"
);
const muteHouse = createRentHouse("静音托管登记盘", agent);
const beforeMute = createMsgs(peer).length;
assert(
  app.call(
    "rental.properties.create",
    {
      house_id: muteHouse,
      management_type: "self_owned",
      manager_user_id: peerId,
      start_date: "2026-03-01",
      end_date: "2028-03-01",
      owner_payment: 1500,
    },
    manager
  ).ok,
  "create while muted"
);
assert(createMsgs(peer).length === beforeMute, "muted rental suppresses create message");

console.log(
  `Rental property create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
