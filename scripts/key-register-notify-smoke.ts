import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "key-register-notify-smoke.db")).dbPath
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
    (m) => m.kind === "key_borrow" && m.title === "钥匙已登记"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

let phoneSeq = 600;
function createHouse(token: string, title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "钥匙登记小区",
      price: 210,
      owner_name: "登记业主",
      owner_phone: `13770${String(phoneSeq).padStart(6, "0")}`,
      status: "available",
    },
    token
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

const houseId = createHouse(agent, "钥匙登记通知盘");
assert(
  !app.call(
    "property.keys.register",
    { house_id: houseId, key_no: "", keeper_user_id: peerId },
    manager
  ).ok,
  "key_no required"
);

const beforeAgent = registerMsgs(agent).length;
const beforePeer = registerMsgs(peer).length;
const beforeManager = registerMsgs(manager).length;
const registered = app.call(
  "property.keys.register",
  {
    house_id: houseId,
    key_no: "KEY-REG-1",
    keeper_user_id: peerId,
    remark: "前台柜",
  },
  manager
);
assert(registered.ok, "manager registers key");
const keyId = data<any>(registered).id;
assert(registerMsgs(agent).length === beforeAgent + 1, "house agent receives register message");
assert(registerMsgs(peer).length === beforePeer + 1, "keeper receives register message");
assert(registerMsgs(manager).length === beforeManager, "actor does not self-notify");
assert(
  registerMsgs(agent).some(
    (m) =>
      m.ref_id === keyId &&
      String(m.body).includes("钥匙登记通知盘") &&
      String(m.body).includes("KEY-REG-1")
  ),
  "register message body"
);
assert(
  !app.call(
    "property.keys.register",
    { house_id: houseId, key_no: "KEY-REG-1", keeper_user_id: peerId },
    manager
  ).ok,
  "duplicate key_no blocked"
);

const selfHouse = createHouse(agent, "自管钥匙盘");
const beforeSelf = registerMsgs(agent).length;
assert(
  app.call(
    "property.keys.register",
    { house_id: selfHouse, key_no: "KEY-REG-SELF", keeper_user_id: agentId },
    agent
  ).ok,
  "agent registers self as keeper"
);
assert(registerMsgs(agent).length === beforeSelf, "self register skips all recipients");

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, peer).ok,
  "mute house"
);
const muteHouse = createHouse(agent, "静音登记盘");
const beforeMute = registerMsgs(peer).length;
assert(
  app.call(
    "property.keys.register",
    { house_id: muteHouse, key_no: "KEY-REG-MUTE", keeper_user_id: peerId },
    manager
  ).ok,
  "register while muted"
);
assert(registerMsgs(peer).length === beforeMute, "muted house suppresses register message");

console.log(`Key register notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
