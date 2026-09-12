import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "house-lock-notify-smoke.db")).dbPath
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
const lockMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "business_record_status" &&
      (m.title === "房源已锁定" || m.title === "房源已解锁")
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const house = app.call(
  "house.create",
  {
    title: "锁定通知房源",
    deal_type: "sale",
    community: "锁定小区",
    price: 280,
    owner_name: "锁定业主",
    owner_phone: "13692001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

assert(
  !app.call(
    "propertyExt.locks.set",
    { id: houseId, locked: true, reason: "短" },
    manager
  ).ok,
  "lock requires meaningful reason"
);

const beforeAgent = lockMsgs(agent).length;
const beforeManager = lockMsgs(manager).length;
const locked = app.call(
  "propertyExt.locks.set",
  { id: houseId, locked: true, reason: "重点盘保护", lock_until: "2099-12-31" },
  manager
);
assert(locked.ok, "manager locks house");
assert(data<any>(locked).is_locked === 1, "is locked");
assert(lockMsgs(agent).length === beforeAgent + 1, "agent receives lock message");
assert(lockMsgs(manager).length === beforeManager, "locker does not self-notify");
assert(
  lockMsgs(agent).some(
    (m) =>
      m.ref_id === houseId &&
      m.title === "房源已锁定" &&
      String(m.body).includes("锁定通知房源") &&
      String(m.body).includes("重点盘保护")
  ),
  "lock message body"
);

const beforeUnlock = lockMsgs(agent).length;
const unlocked = app.call(
  "propertyExt.locks.set",
  { id: houseId, locked: false, reason: "保护期结束" },
  manager
);
assert(unlocked.ok, "manager unlocks house");
assert(data<any>(unlocked).is_locked === 0, "is unlocked");
assert(lockMsgs(agent).length === beforeUnlock + 1, "agent receives unlock message");
assert(
  lockMsgs(agent).some(
    (m) => m.ref_id === houseId && m.title === "房源已解锁"
  ),
  "unlock title"
);

const selfHouse = app.call(
  "house.create",
  {
    title: "自行锁定房源",
    deal_type: "sale",
    community: "锁定小区",
    price: 260,
    owner_name: "自行业主",
    owner_phone: "13692002222",
    status: "available",
  },
  agent
);
assert(selfHouse.ok, "create self house");
const beforeSelf = lockMsgs(agent).length;
assert(
  app.call(
    "propertyExt.locks.set",
    { id: data<any>(selfHouse).id, locked: true, reason: "自行保护" },
    agent
  ).ok,
  "agent locks own house"
);
assert(lockMsgs(agent).length === beforeSelf, "self-lock skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const mutedHouse = app.call(
  "house.create",
  {
    title: "静音锁定房源",
    deal_type: "sale",
    community: "锁定小区",
    price: 250,
    owner_name: "静音业主",
    owner_phone: "13692003333",
    status: "available",
  },
  agent
);
assert(mutedHouse.ok, "create muted house");
const beforeMute = lockMsgs(agent).length;
assert(
  app.call(
    "propertyExt.locks.set",
    { id: data<any>(mutedHouse).id, locked: true, reason: "静音锁定测试" },
    manager
  ).ok,
  "lock while muted"
);
assert(lockMsgs(agent).length === beforeMute, "muted other suppresses lock message");

console.log(`House lock notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
