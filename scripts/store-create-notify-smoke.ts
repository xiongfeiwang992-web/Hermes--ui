import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "store-create-notify-smoke.db")).dbPath
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
const storeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "新门店已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call("org.stores.upsert", { name: "越权店" }, manager).ok,
  "manager cannot create store"
);

const beforeAdmin = storeMsgs(admin).length;
const beforeManager = storeMsgs(manager).length;
const beforeAgent = storeMsgs(agent).length;
const created = app.call(
  "org.stores.upsert",
  { name: "通知新店", address: "通知路 9 号" },
  admin
);
assert(created.ok, "admin creates store");
const storeId = data<any>(created).id;
assert(storeMsgs(admin).length === beforeAdmin, "creator does not self-notify");
assert(storeMsgs(manager).length === beforeManager + 1, "manager receives store message");
assert(storeMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  storeMsgs(manager).some(
    (m) => m.ref_id === storeId && String(m.body).includes("通知新店")
  ),
  "store message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = storeMsgs(manager).length;
assert(
  app.call("org.stores.upsert", { name: "静音新店", address: "静音路 1 号" }, admin).ok,
  "create while muted"
);
assert(storeMsgs(manager).length === beforeMute, "muted other suppresses message");

console.log(`Store create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
