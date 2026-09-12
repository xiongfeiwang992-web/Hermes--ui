import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-role-assign-notify-smoke.db")).dbPath
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
const assignMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "house_role" && m.title === "房源角色已指派"
  );

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

let phoneSeq = 7200;
function createHouse(title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "角色指派小区",
      price: 260,
      owner_name: "角色指派业主",
      owner_phone: `1376${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    agentA
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

assert(
  !app.call(
    "house.roles.assign",
    {
      house_id: "missing",
      role_type: "photographer",
      user_id: agentBId,
    },
    agentA
  ).ok,
  "agent cannot assign roles"
);

const houseId = createHouse("指派通知盘");
const beforeAgentB = assignMsgs(agentB).length;
const beforeManager = assignMsgs(manager).length;
const assigned = app.call(
  "house.roles.assign",
  {
    house_id: houseId,
    role_type: "photographer",
    user_id: agentBId,
    protected_until: "2026-12-31",
  },
  manager
);
assert(assigned.ok, "manager assigns photographer");
assert(
  assignMsgs(agentB).length === beforeAgentB + 1,
  "holder receives assign message"
);
assert(assignMsgs(manager).length === beforeManager, "assigner skips self");
assert(
  assignMsgs(agentB).some(
    (m) =>
      m.ref_id === houseId &&
      m.ref_type === "house" &&
      String(m.body).includes("指派通知盘") &&
      String(m.body).includes("摄影师") &&
      String(m.body).includes("2026-12-31")
  ),
  "assign message body"
);

const selfBefore = assignMsgs(manager).length;
assert(
  app.call(
    "house.roles.assign",
    {
      house_id: houseId,
      role_type: "key_keeper",
      user_id: managerId,
    },
    manager
  ).ok,
  "manager self-assigns key keeper"
);
assert(assignMsgs(manager).length === selfBefore, "self-assign skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agentA).ok,
  "mute house"
);
const muteHouseId = createHouse("静音指派盘");
const beforeMute = assignMsgs(agentA).length;
assert(
  app.call(
    "house.roles.assign",
    {
      house_id: muteHouseId,
      role_type: "surveyor",
      user_id: agentAId,
    },
    manager
  ).ok,
  "assign while muted"
);
assert(assignMsgs(agentA).length === beforeMute, "muted house suppresses assign message");

console.log(
  `House role assign notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
