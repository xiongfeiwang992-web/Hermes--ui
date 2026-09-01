import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-status-notify-smoke.db")).dbPath
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
const statusMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "house_agent" && m.title === "房源状态已更新"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

const house = app.call(
  "house.create",
  {
    title: "状态通知房源",
    deal_type: "sale",
    community: "状态苑",
    price: 200,
    owner_name: "状态业主",
    owner_phone: "13788001111",
    status: "available",
  },
  agent
);
assert(house.ok, "agent creates house");
const houseId = data<any>(house).id;

const beforeAgent = statusMsgs(agent).length;
const beforeManager = statusMsgs(manager).length;
assert(
  app.call("house.status", { id: houseId, status: "suspended" }, manager).ok,
  "manager suspends house"
);
assert(statusMsgs(agent).length === beforeAgent + 1, "agent receives status message");
assert(statusMsgs(manager).length === beforeManager, "manager actor skips self");
assert(
  statusMsgs(agent).some(
    (m) =>
      m.ref_id === houseId &&
      String(m.body).includes("状态通知房源") &&
      String(m.body).includes("available → suspended")
  ),
  "status message body"
);

assert(
  app.call("house.status", { id: houseId, status: "available" }, agent).ok,
  "agent resumes own house"
);
const beforeSelf = statusMsgs(agent).length;
assert(
  app.call("house.status", { id: houseId, status: "suspended" }, agent).ok,
  "agent suspends own house"
);
assert(statusMsgs(agent).length === beforeSelf, "agent skips self-notify on own status change");

assert(
  app.call("house.status", { id: houseId, status: "available" }, manager).ok,
  "manager resumes without agent change"
);
assert(
  app.call("house.status", { id: houseId, status: "suspended" }, manager).ok,
  "manager suspends again"
);
const beforeResume = statusMsgs(agent).length;
const beforeAssign = data<any[]>(app.call("message.list", {}, peer)).filter(
  (m) => m.kind === "house_agent" && m.title === "接盘房源已分配"
).length;
assert(
  app.call(
    "house.status",
    { id: houseId, status: "available", agent_id: peerId },
    manager
  ).ok,
  "manager resumes with new agent"
);
assert(
  statusMsgs(agent).length === beforeResume,
  "status message skipped when agent reassigned"
);
assert(
  data<any[]>(app.call("message.list", {}, peer)).filter(
    (m) => m.kind === "house_agent" && m.title === "接盘房源已分配"
  ).length ===
    beforeAssign + 1,
  "new agent still receives assign message"
);

const house2 = app.call(
  "house.create",
  {
    title: "静音状态房源",
    deal_type: "sale",
    community: "静音苑",
    price: 180,
    owner_name: "静音业主",
    owner_phone: "13788002222",
    status: "available",
  },
  agent
);
assert(house2.ok, "create mute house");
assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agent).ok,
  "mute house"
);
const beforeMute = statusMsgs(agent).length;
assert(
  app.call("house.status", { id: data<any>(house2).id, status: "suspended" }, manager).ok,
  "suspend while muted"
);
assert(statusMsgs(agent).length === beforeMute, "muted house suppresses status message");

console.log(`House status notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
