import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-verification-submit-notify-smoke.db")).dbPath
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
const pendingMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "verification_pending" && m.title === "房源验真待审核"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;
const managerName = data<any>(app.call("auth.me", {}, manager)).display_name;

let phoneSeq = 820;
function createSaleHouse(title: string, token: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "验真提交小区",
      price: 210,
      owner_name: "验真业主",
      owner_phone: `1361${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    token
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

const houseTitle = "验真提交通知盘";
const houseId = createSaleHouse(houseTitle, agent);

const beforeAdmin = pendingMsgs(admin).length;
const beforeManager = pendingMsgs(manager).length;
const beforeAgent = pendingMsgs(agent).length;
const beforePeer = pendingMsgs(peer).length;

const submitted = app.call(
  "property.verifications.submit",
  {
    house_id: houseId,
    contact_result: "业主确认在售",
    price_confirmed: 210,
    availability_confirmed: true,
  },
  agent
);
assert(submitted.ok, "agent submits verification");
const verificationId = data<any>(submitted).id;

assert(pendingMsgs(admin).length === beforeAdmin + 1, "admin receives pending verification");
assert(
  pendingMsgs(manager).length === beforeManager + 1,
  "manager receives pending verification"
);
assert(pendingMsgs(agent).length === beforeAgent, "submitter skips self");
assert(pendingMsgs(peer).length === beforePeer, "peer agent not notified");
assert(
  pendingMsgs(manager).some(
    (m) =>
      m.ref_id === verificationId &&
      m.ref_type === "house_verification" &&
      String(m.body).includes(agentName) &&
      String(m.body).includes(houseTitle)
  ),
  "pending verification body includes submitter and house"
);

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, manager).ok,
  "mute house"
);
const beforeMute = pendingMsgs(manager).length;
const mutedHouseId = createSaleHouse("静音验真盘", agent);
assert(
  app.call(
    "property.verifications.submit",
    {
      house_id: mutedHouseId,
      contact_result: "静音提交",
      price_confirmed: 180,
      availability_confirmed: true,
    },
    agent
  ).ok,
  "submit while muted"
);
assert(
  pendingMsgs(manager).length === beforeMute,
  "muted house suppresses pending verification"
);

const managerHouseId = createSaleHouse("店长自提验真盘", manager);
const beforeManagerSelf = pendingMsgs(manager).length;
const managerSubmit = app.call(
  "property.verifications.submit",
  {
    house_id: managerHouseId,
    contact_result: "店长自提",
    price_confirmed: 199,
    availability_confirmed: true,
  },
  manager
);
assert(managerSubmit.ok, "manager submits own verification");
assert(
  pendingMsgs(manager).length === beforeManagerSelf,
  "manager skips self on own submission"
);
assert(
  pendingMsgs(admin).some((m) => m.ref_id === data<any>(managerSubmit).id),
  "admin still notified when manager submits"
);
assert(
  pendingMsgs(admin).some(
    (m) =>
      m.ref_id === data<any>(managerSubmit).id && String(m.body).includes(managerName)
  ),
  "admin message includes manager name"
);

console.log(
  `House verification submit notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
