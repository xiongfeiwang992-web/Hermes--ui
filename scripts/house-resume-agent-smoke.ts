import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "house-resume-agent-smoke.db")).dbPath);
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

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const otherStore = login("agent_c");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const otherId = data<any>(app.call("auth.me", {}, otherStore)).id;

const house = app.call(
  "house.create",
  {
    title: "暂缓恢复房源",
    deal_type: "sale",
    community: "接盘苑",
    price: 198,
    owner_name: "业主",
    owner_phone: "13220001111",
    status: "available",
  },
  agentA
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;
assert(data<any>(house).agent_id === agentAId, "creator is holder");

assert(
  app.call("house.status", { id: houseId, status: "suspended" }, agentA).ok,
  "agent suspends house"
);
assert(
  data<any>(app.call("house.get", { id: houseId }, agentA)).status === "suspended",
  "house is suspended"
);

assert(
  !app.call(
    "house.status",
    { id: houseId, status: "available", agent_id: agentBId },
    agentA
  ).ok,
  "agent cannot change holder on resume"
);
assert(
  app.call("house.status", { id: houseId, status: "available" }, agentA).ok,
  "agent can resume without holder change"
);
assert(
  app.call("house.status", { id: houseId, status: "suspended" }, manager).ok,
  "manager suspends again"
);

const resumed = app.call(
  "house.status",
  { id: houseId, status: "available", agent_id: agentBId },
  manager
);
assert(resumed.ok, "manager resumes with new holder");
assert(data<any>(resumed).status === "available", "resumed to available");
assert(data<any>(resumed).agent_id === agentBId, "holder changed on resume");
assert(
  data<any[]>(app.call("message.list", {}, agentB)).some(
    (msg) => msg.kind === "house_agent" && String(msg.body).includes("恢复上架")
  ),
  "new holder notified"
);
assert(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (msg) => msg.kind === "house_agent" && String(msg.body).includes("接盘人已变更")
  ),
  "old holder notified"
);

assert(
  !app.call("house.agent", { id: houseId, agent_id: agentAId }, agentA).ok,
  "agent cannot change holder directly"
);
assert(
  !app.call("house.agent", { id: houseId, agent_id: otherId }, manager).ok,
  "cannot assign cross-store holder"
);
assert(
  !app.call("house.agent", { id: houseId, agent_id: agentBId }, manager).ok,
  "reject unchanged holder"
);

const reassigned = app.call("house.agent", { id: houseId, agent_id: agentAId }, manager);
assert(reassigned.ok, "manager reassigns holder");
assert(data<any>(reassigned).agent_id === agentAId, "holder is agent A again");
assert(
  data<any[]>(app.call("message.list", {}, agentA)).some((msg) =>
    String(msg.title).includes("接盘房源已分配")
  ),
  "reassigned holder notified"
);

assert(
  app.call("house.status", { id: houseId, status: "withdrawn", reason: "业主不卖了" }, manager)
    .ok,
  "withdraw house"
);
assert(
  !app.call("house.agent", { id: houseId, agent_id: agentBId }, manager).ok,
  "cannot change holder after withdraw"
);

console.log(`House resume/agent smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
