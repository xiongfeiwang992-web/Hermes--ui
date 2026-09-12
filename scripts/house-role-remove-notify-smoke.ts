import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-role-remove-notify-smoke.db")).dbPath
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
const removeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "house_role" && m.title === "房源角色已解除"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

let phoneSeq = 6100;
function createHouse(title: string, byToken: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "角色解除小区",
      price: 240,
      owner_name: "角色解除业主",
      owner_phone: `1375${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    byToken
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

function assignRole(
  houseId: string,
  roleType: string,
  userId: string,
  byToken: string,
  protectedUntil?: string
) {
  const payload: any = {
    house_id: houseId,
    role_type: roleType,
    user_id: userId,
  };
  if (protectedUntil) payload.protected_until = protectedUntil;
  const assigned = app.call("house.roles.assign", payload, byToken);
  assert(assigned.ok, `assign ${roleType}`);
  return assigned.ok ? data<any>(assigned).id : "";
}

assert(
  !app.call("house.roles.remove", { id: "missing" }, agentA).ok,
  "agent cannot remove roles"
);

const openHouseId = createHouse("解除通知盘", agentA);
const openRoleId = assignRole(openHouseId, "photographer", agentBId, manager);
const beforeAgentB = removeMsgs(agentB).length;
const beforeManager = removeMsgs(manager).length;
const removed = app.call("house.roles.remove", { id: openRoleId }, manager);
assert(removed.ok, "manager removes unprotected role");
const afterAgentB = removeMsgs(agentB);
assert(afterAgentB.length === beforeAgentB + 1, "role holder receives remove message");
assert(afterAgentB[0].ref_id === openHouseId, "message refs house");
assert(String(afterAgentB[0].body).includes("解除通知盘"), "body has house title");
assert(String(afterAgentB[0].body).includes("photographer"), "body has role type");
assert(!String(afterAgentB[0].body).includes(" · "), "unprotected remove omits reason sep");
assert(removeMsgs(manager).length === beforeManager, "remover does not self-notify");
assert(
  !app.call("house.roles.remove", { id: openRoleId }, manager).ok,
  "cannot remove twice"
);

const protectedHouseId = createHouse("保护解除盘", agentA);
const protectedUntil = new Date(Date.now() + 20 * 86400000).toISOString();
const protectedRoleId = assignRole(
  protectedHouseId,
  "surveyor",
  agentBId,
  manager,
  protectedUntil
);
assert(
  !app.call("house.roles.remove", { id: protectedRoleId }, manager).ok,
  "manager cannot remove protected role"
);
assert(
  !app.call(
    "house.roles.remove",
    { id: protectedRoleId, reason: "" },
    admin
  ).ok,
  "admin protected remove requires reason"
);
const beforeProtected = removeMsgs(agentB).length;
assert(
  app.call(
    "house.roles.remove",
    { id: protectedRoleId, reason: "人员工作调整" },
    admin
  ).ok,
  "admin removes protected role with reason"
);
assert(
  removeMsgs(agentB).some(
    (m) =>
      m.ref_id === protectedHouseId &&
      String(m.body).includes("surveyor") &&
      String(m.body).includes("人员工作调整")
  ),
  "protected remove message includes reason"
);
assert(
  removeMsgs(agentB).length === beforeProtected + 1,
  "exactly one protected remove message"
);

const selfHouseId = createHouse("自解除角色盘", agentA);
const selfRoleId = assignRole(selfHouseId, "key_keeper", managerId, manager);
const beforeSelf = removeMsgs(manager).length;
assert(
  app.call("house.roles.remove", { id: selfRoleId }, manager).ok,
  "manager removes own role"
);
assert(removeMsgs(manager).length === beforeSelf, "self-remove skips notify");

const muteHouseId = createHouse("静音解除盘", agentA);
const muteRoleId = assignRole(muteHouseId, "floorplan", agentAId, manager);
assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agentA).ok,
  "mute house channel"
);
const beforeMute = removeMsgs(agentA).length;
assert(
  app.call("house.roles.remove", { id: muteRoleId }, manager).ok,
  "remove while holder muted"
);
assert(removeMsgs(agentA).length === beforeMute, "muted house suppresses remove message");

console.log(`House role remove notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
