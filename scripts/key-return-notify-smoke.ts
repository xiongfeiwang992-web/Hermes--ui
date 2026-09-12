import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "key-return-notify-smoke.db")).dbPath
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
const returnMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "key_borrow" && m.title === "钥匙已归还"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

let phoneSeq = 100;
function createHouse(title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "钥匙归还小区",
      price: 200,
      owner_name: "钥匙业主",
      owner_phone: `13693${String(phoneSeq).padStart(6, "0")}`,
      status: "available",
    },
    agent
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

function registerAndBorrow(houseId: string, keyNo: string, keeperId: string) {
  const key = app.call(
    "property.keys.register",
    {
      house_id: houseId,
      key_no: keyNo,
      keeper_user_id: keeperId,
      remark: "归还通知测试",
    },
    manager
  );
  assert(key.ok, `register ${keyNo}`);
  const keyId = data<any>(key).id;
  assert(
    app.call(
      "property.keys.borrow",
      {
        id: keyId,
        borrower_user_id: peerId,
        expected_return_at: new Date(Date.now() + 86400000).toISOString(),
      },
      manager
    ).ok,
    `borrow ${keyNo}`
  );
  return keyId;
}

const houseId = createHouse("钥匙归还通知盘");
const keyId = registerAndBorrow(houseId, "KEY-RET-1", agentId);

const beforeAgent = returnMsgs(agent).length;
const beforeManager = returnMsgs(manager).length;
const beforePeer = returnMsgs(peer).length;
const returned = app.call("property.keys.return", { id: keyId }, manager);
assert(returned.ok, "manager returns key");
assert(returnMsgs(agent).length === beforeAgent + 1, "keeper/agent receives return message");
assert(returnMsgs(manager).length === beforeManager, "returner does not self-notify");
assert(returnMsgs(peer).length === beforePeer, "borrower does not get return notify");
assert(
  returnMsgs(agent).some(
    (m) =>
      m.ref_id === keyId &&
      String(m.body).includes("钥匙归还通知盘") &&
      String(m.body).includes("KEY-RET-1")
  ),
  "return message body"
);

const selfHouse = createHouse("自行归还钥匙盘");
const selfKey = registerAndBorrow(selfHouse, "KEY-RET-2", agentId);
const beforeSelf = returnMsgs(agent).length;
assert(
  app.call("property.keys.return", { id: selfKey }, agent).ok,
  "agent returns as keeper"
);
assert(returnMsgs(agent).length === beforeSelf, "self return skips notify");

const mutedHouse = createHouse("静音归还钥匙盘");
const mutedKey = registerAndBorrow(mutedHouse, "KEY-RET-3", agentId);
assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agent).ok,
  "mute house channel"
);
const beforeMute = returnMsgs(agent).length;
assert(
  app.call("property.keys.return", { id: mutedKey }, manager).ok,
  "return while muted"
);
assert(returnMsgs(agent).length === beforeMute, "muted house suppresses return message");

console.log(`Key return notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
