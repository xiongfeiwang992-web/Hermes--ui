import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "key-invalidate-notify-smoke.db")).dbPath
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
const invalidMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "key_borrow" && m.title === "钥匙已作废"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

let phoneSeq = 300;
function createHouse(title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "钥匙作废小区",
      price: 200,
      owner_name: "作废业主",
      owner_phone: `13695${String(phoneSeq).padStart(6, "0")}`,
      status: "available",
    },
    agent
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

function registerKey(houseId: string, keyNo: string, keeperId: string) {
  const key = app.call(
    "property.keys.register",
    {
      house_id: houseId,
      key_no: keyNo,
      keeper_user_id: keeperId,
      remark: "作废通知测试",
    },
    manager
  );
  assert(key.ok, `register ${keyNo}`);
  return data<any>(key).id;
}

const houseId = createHouse("钥匙作废通知盘");
const keyId = registerKey(houseId, "KEY-INV-1", agentId);

assert(
  !app.call("property.keys.invalidate", { id: keyId, reason: "" }, manager).ok,
  "invalidate requires reason"
);
assert(
  !app.call("property.keys.invalidate", { id: keyId, reason: "测试作废" }, peer).ok,
  "peer cannot invalidate"
);

const beforeAgent = invalidMsgs(agent).length;
const beforeManager = invalidMsgs(manager).length;
const invalidated = app.call(
  "property.keys.invalidate",
  { id: keyId, reason: "钥匙损坏报废" },
  manager
);
assert(invalidated.ok, "manager invalidates key");
assert(invalidMsgs(agent).length === beforeAgent + 1, "keeper/agent receives message");
assert(invalidMsgs(manager).length === beforeManager, "actor does not self-notify");
assert(
  invalidMsgs(agent).some(
    (m) =>
      m.ref_id === keyId &&
      String(m.body).includes("钥匙作废通知盘") &&
      String(m.body).includes("KEY-INV-1") &&
      String(m.body).includes("钥匙损坏报废")
  ),
  "invalidate message body"
);

// borrowed key cannot invalidate
const house2 = createHouse("借出不可作废盘");
const borrowedKey = registerKey(house2, "KEY-INV-2", agentId);
assert(
  app.call(
    "property.keys.borrow",
    {
      id: borrowedKey,
      expected_return_at: new Date(Date.now() + 86400000).toISOString(),
    },
    agent
  ).ok,
  "borrow key"
);
assert(
  !app.call(
    "property.keys.invalidate",
    { id: borrowedKey, reason: "借出中作废" },
    manager
  ).ok,
  "cannot invalidate borrowed key"
);

assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agent).ok,
  "mute house"
);
const mutedHouse = createHouse("静音作废钥匙盘");
const mutedKey = registerKey(mutedHouse, "KEY-INV-3", agentId);
const beforeMute = invalidMsgs(agent).length;
assert(
  app.call(
    "property.keys.invalidate",
    { id: mutedKey, reason: "静音作废" },
    manager
  ).ok,
  "invalidate while muted"
);
assert(invalidMsgs(agent).length === beforeMute, "muted house suppresses invalidate message");

console.log(`Key invalidate notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
