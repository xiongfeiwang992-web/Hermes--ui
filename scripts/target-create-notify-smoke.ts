import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "target-create-notify-smoke.db"));
const app = createApp(seeded.dbPath);

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
const userTargetMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "performance" && m.title === "业绩目标已下达"
  );
const storeTargetMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "performance" && m.title === "门店业绩目标已下达"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const beforeAgent = userTargetMsgs(agent).length;
const beforeManager = userTargetMsgs(manager).length;
const userTarget = app.call(
  "performance.targets.save",
  {
    period_month: "2026-09",
    metric: "deals",
    target_value: 3,
    store_id: seeded.storeA,
    user_id: agentId,
  },
  manager
);
assert(userTarget.ok, "manager creates employee target");
const userTargetId = data<any>(userTarget).id;
assert(userTargetMsgs(agent).length === beforeAgent + 1, "agent receives personal target");
assert(userTargetMsgs(manager).length === beforeManager, "manager actor skips self");
assert(
  userTargetMsgs(agent).some(
    (m) =>
      m.ref_id === userTargetId &&
      String(m.body).includes("2026-09") &&
      String(m.body).includes("成交套数") &&
      String(m.body).includes("3")
  ),
  "personal target message body"
);

const beforeStoreAgent = storeTargetMsgs(agent).length;
const beforeStorePeer = storeTargetMsgs(peer).length;
const beforeStoreManager = storeTargetMsgs(manager).length;
const storeTarget = app.call(
  "performance.targets.save",
  {
    period_month: "2026-09",
    metric: "commission",
    target_value: 50000,
    store_id: seeded.storeA,
  },
  manager
);
assert(storeTarget.ok, "manager creates store target");
const storeTargetId = data<any>(storeTarget).id;
assert(storeTargetMsgs(agent).length === beforeStoreAgent + 1, "agent receives store target");
assert(storeTargetMsgs(peer).length === beforeStorePeer + 1, "peer receives store target");
assert(storeTargetMsgs(manager).length === beforeStoreManager, "manager skips store self-notify");
assert(
  storeTargetMsgs(agent).some(
    (m) =>
      m.ref_id === storeTargetId &&
      String(m.body).includes("佣金") &&
      String(m.body).includes("50000")
  ),
  "store target message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { performance: false } }, agent).ok,
  "mute performance"
);
const beforeMute = userTargetMsgs(agent).length;
assert(
  app.call(
    "performance.targets.save",
    {
      period_month: "2026-10",
      metric: "deals",
      target_value: 1,
      store_id: seeded.storeA,
      user_id: agentId,
    },
    manager
  ).ok,
  "create while muted"
);
assert(userTargetMsgs(agent).length === beforeMute, "muted performance suppresses message");

console.log(`Target create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
