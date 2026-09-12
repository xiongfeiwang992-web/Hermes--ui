import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-create-notify-smoke.db")).dbPath
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
const houseMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "house_agent" && m.title === "新房源已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

const beforeAdmin = houseMsgs(admin).length;
const beforeManager = houseMsgs(manager).length;
const beforeAgent = houseMsgs(agent).length;
const created = app.call(
  "house.create",
  {
    title: "登记通知房源",
    deal_type: "sale",
    community: "通知小区",
    price: 199,
    owner_name: "通知业主",
    owner_phone: "13877001111",
    status: "available",
  },
  agent
);
assert(created.ok, "agent creates house");
const houseId = data<any>(created).id;
assert(houseMsgs(admin).length === beforeAdmin + 1, "admin receives house create message");
assert(houseMsgs(manager).length === beforeManager + 1, "manager receives house create message");
assert(houseMsgs(agent).length === beforeAgent, "creator does not self-notify");
assert(
  houseMsgs(manager).some(
    (m) =>
      m.ref_id === houseId &&
      String(m.body).includes("登记通知房源") &&
      String(m.body).includes(agentName)
  ),
  "house create message body"
);

const beforeSelfMgr = houseMsgs(manager).length;
const beforeSelfAdmin = houseMsgs(admin).length;
const mgrHouse = app.call(
  "house.create",
  {
    title: "店长自登记房源",
    deal_type: "sale",
    community: "通知小区",
    price: 188,
    owner_name: "店长业主",
    owner_phone: "13877002222",
    status: "available",
  },
  manager
);
assert(mgrHouse.ok, "manager creates house");
assert(houseMsgs(manager).length === beforeSelfMgr, "manager actor skips self");
assert(houseMsgs(admin).length === beforeSelfAdmin + 1, "admin notified for manager create");

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, admin).ok,
  "mute house"
);
const beforeMute = houseMsgs(admin).length;
const beforeMuteMgr = houseMsgs(manager).length;
const muted = app.call(
  "house.create",
  {
    title: "静音登记房源",
    deal_type: "sale",
    community: "通知小区",
    price: 177,
    owner_name: "静音业主",
    owner_phone: "13877003333",
    status: "available",
  },
  agent
);
assert(muted.ok, "create while muted");
assert(houseMsgs(admin).length === beforeMute, "muted house suppresses message");
assert(
  houseMsgs(manager).length === beforeMuteMgr + 1,
  "manager still receives when admin muted"
);

console.log(`House create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
