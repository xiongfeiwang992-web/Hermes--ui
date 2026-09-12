import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "commission-tier-create-notify-smoke.db")).dbPath
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
const tierMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "提成阶梯已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "config.commissionTiers.save",
    { min_amount: 0, max_amount: 10000, pool_rate: 0.5 },
    manager
  ).ok,
  "manager cannot create commission tier"
);

const beforeAdmin = tierMsgs(admin).length;
const beforeManager = tierMsgs(manager).length;
const beforeAgent = tierMsgs(agent).length;
const created = app.call(
  "config.commissionTiers.save",
  { min_amount: 0, max_amount: 20000, pool_rate: 0.45 },
  admin
);
assert(created.ok, "admin creates commission tier");
const tierId = data<any>(created).id;
assert(tierMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(tierMsgs(manager).length === beforeManager + 1, "manager receives tier message");
assert(tierMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  tierMsgs(manager).some(
    (m) =>
      m.ref_id === tierId &&
      String(m.body).includes("0") &&
      String(m.body).includes("20000") &&
      String(m.body).includes("0.45")
  ),
  "tier message body with range"
);

const beforeOpen = tierMsgs(manager).length;
const openTier = app.call(
  "config.commissionTiers.save",
  { min_amount: 20000, max_amount: null, pool_rate: 0.55 },
  admin
);
assert(openTier.ok, "admin creates open-ended tier");
assert(tierMsgs(manager).length === beforeOpen + 1, "manager receives open-ended tier message");
assert(
  tierMsgs(manager).some((m) => m.ref_id === data<any>(openTier).id && String(m.body).includes("20000+")),
  "open-ended tier body"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = tierMsgs(manager).length;
assert(
  app.call(
    "config.commissionTiers.save",
    { min_amount: 50000, max_amount: 80000, pool_rate: 0.6 },
    admin
  ).ok,
  "create while muted"
);
assert(tierMsgs(manager).length === beforeMute, "muted other suppresses message");

console.log(`Commission tier create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
