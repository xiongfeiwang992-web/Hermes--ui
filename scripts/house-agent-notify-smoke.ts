import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-agent-notify-smoke.db")).dbPath
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
const assignedMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "house_agent" && m.title === "接盘房源已分配"
  );
const changedMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "house_agent" && m.title === "接盘人已变更"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const managerId = data<any>(app.call("auth.me", {}, manager)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerName = data<any>(app.call("auth.me", {}, peer)).display_name;
const managerName = data<any>(app.call("auth.me", {}, manager)).display_name;

const houseTitle = "改接盘人通知盘";
const house = app.call(
  "house.create",
  {
    title: houseTitle,
    deal_type: "sale",
    community: "改接盘小区",
    price: 210,
    owner_name: "改接盘业主",
    owner_phone: "13790100001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

assert(
  !app.call("house.agent", { id: houseId, agent_id: peerId }, agent).ok,
  "agent cannot change holder"
);
assert(
  !app.call("house.agent", { id: houseId, agent_id: agentId }, manager).ok,
  "unchanged holder rejected"
);

const beforePeerAssign = assignedMsgs(peer).length;
const beforeAgentChange = changedMsgs(agent).length;
const beforeManagerAssign = assignedMsgs(manager).length;
const beforeManagerChange = changedMsgs(manager).length;
const reassigned = app.call("house.agent", { id: houseId, agent_id: peerId }, manager);
assert(reassigned.ok, "manager assigns to peer");
assert(assignedMsgs(peer).length === beforePeerAssign + 1, "new holder receives assign");
assert(changedMsgs(agent).length === beforeAgentChange + 1, "old holder receives change");
assert(assignedMsgs(manager).length === beforeManagerAssign, "manager skips assign");
assert(changedMsgs(manager).length === beforeManagerChange, "manager skips change");
assert(
  assignedMsgs(peer).some(
    (m) =>
      m.ref_id === houseId &&
      m.ref_type === "house" &&
      String(m.body).includes(houseTitle)
  ),
  "assign body includes house"
);
assert(
  changedMsgs(agent).some(
    (m) => m.ref_id === houseId && String(m.body).includes(peerName)
  ),
  "change body includes new holder name"
);

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, peer).ok,
  "mute house"
);
const beforeMutePeerChange = changedMsgs(peer).length;
const beforeMuteAgentAssign = assignedMsgs(agent).length;
assert(
  app.call("house.agent", { id: houseId, agent_id: agentId }, manager).ok,
  "reassign while muted"
);
assert(
  changedMsgs(peer).length === beforeMutePeerChange,
  "muted house suppresses old-holder change"
);
assert(
  assignedMsgs(agent).length === beforeMuteAgentAssign + 1,
  "new holder still notified while peer muted"
);

const beforeSelfManager = assignedMsgs(manager).length;
const beforeSelfAgent = changedMsgs(agent).length;
assert(
  app.call("house.agent", { id: houseId, agent_id: managerId }, manager).ok,
  "manager assigns to self"
);
assert(assignedMsgs(manager).length === beforeSelfManager, "self-assign skips notify");
assert(
  changedMsgs(agent).some(
    (m) =>
      m.ref_id === houseId &&
      String(m.body).includes(managerName) &&
      changedMsgs(agent).length === beforeSelfAgent + 1
  ),
  "old holder notified when manager takes over"
);

console.log(`House agent notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
