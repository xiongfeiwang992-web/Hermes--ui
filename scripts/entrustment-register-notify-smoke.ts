import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "entrustment-register-notify-smoke.db")).dbPath
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
const registerMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "entrustment_terminated" && m.title === "业主委托已登记"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

let phoneSeq = 900;
function createHouse(token: string, title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "委托登记小区",
      price: 260,
      owner_name: "登记委托业主",
      owner_phone: `1344${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    token
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

const houseId = createHouse(agent, "委托登记通知盘");
assert(
  !app.call(
    "entrustment.register",
    {
      house_id: houseId,
      entrust_type: "general",
      start_at: "2026-01-01T00:00:00.000Z",
      end_at: "2025-01-01T00:00:00.000Z",
    },
    manager
  ).ok,
  "invalid date range rejected"
);

const beforeAgent = registerMsgs(agent).length;
const beforeManager = registerMsgs(manager).length;
const registered = app.call(
  "entrustment.register",
  {
    house_id: houseId,
    entrust_type: "exclusive",
    start_at: "2026-01-01T00:00:00.000Z",
    end_at: "2026-12-31T00:00:00.000Z",
    remark: "登记通知测试",
  },
  manager
);
assert(registered.ok, "manager registers entrustment");
const entrustId = data<any>(registered).id;
assert(registerMsgs(agent).length === beforeAgent + 1, "house agent receives register message");
assert(registerMsgs(manager).length === beforeManager, "actor does not self-notify");
assert(
  registerMsgs(agent).some(
    (m) =>
      m.ref_id === entrustId &&
      String(m.body).includes("委托登记通知盘") &&
      String(m.body).includes("exclusive") &&
      String(m.body).includes("2026-12-31")
  ),
  "register message body"
);

const selfHouse = createHouse(agent, "自盘委托登记");
const beforeSelf = registerMsgs(agent).length;
assert(
  app.call(
    "entrustment.register",
    {
      house_id: selfHouse,
      entrust_type: "general",
      start_at: "2026-02-01T00:00:00.000Z",
      end_at: "2027-02-01T00:00:00.000Z",
    },
    agent
  ).ok,
  "agent registers own house entrustment"
);
assert(registerMsgs(agent).length === beforeSelf, "self register skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, peer).ok,
  "mute house"
);
const muteHouse = createHouse(peer, "静音委托登记盘");
const beforeMute = registerMsgs(peer).length;
assert(
  app.call(
    "entrustment.register",
    {
      house_id: muteHouse,
      entrust_type: "general",
      start_at: "2026-03-01T00:00:00.000Z",
      end_at: "2027-03-01T00:00:00.000Z",
    },
    manager
  ).ok,
  "register while muted"
);
assert(registerMsgs(peer).length === beforeMute, "muted house suppresses register message");

console.log(
  `Entrustment register notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
