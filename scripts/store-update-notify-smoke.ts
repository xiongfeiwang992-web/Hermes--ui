import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "store-update-notify-smoke.db")).dbPath
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
const updateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "门店信息已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const storeId = data<any>(app.call("auth.me", {}, manager)).store_id;

assert(
  !app.call(
    "org.stores.upsert",
    { id: storeId, name: "店长不可改门店", address: "越权路" },
    manager
  ).ok,
  "manager cannot update store"
);

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const updated = app.call(
  "org.stores.upsert",
  { id: storeId, name: "一号店改名", address: "示例路 1 号改" },
  admin
);
assert(updated.ok, "admin updates store");
assert(updateMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(updateMsgs(manager).length === beforeManager + 1, "store manager receives update");
assert(updateMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === storeId &&
      m.ref_type === "store" &&
      String(m.body).includes("一号店改名")
  ),
  "store update message body"
);

const beforeSecond = updateMsgs(manager).length;
assert(
  app.call(
    "org.stores.upsert",
    { id: storeId, name: "一号店再改", status: "active" },
    admin
  ).ok,
  "admin updates store again"
);
assert(updateMsgs(manager).length === beforeSecond + 1, "each update notifies");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = updateMsgs(manager).length;
assert(
  app.call(
    "org.stores.upsert",
    { id: storeId, name: "静音门店名" },
    admin
  ).ok,
  "update while muted"
);
assert(updateMsgs(manager).length === beforeMute, "muted other suppresses update message");

console.log(`Store update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
