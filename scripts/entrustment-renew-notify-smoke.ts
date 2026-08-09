import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "entrustment-renew-notify-smoke.db")).dbPath
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
const renewMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "entrustment_renewed" && m.title === "业主委托已续期"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

let phoneSeq = 7200;
function createHouse(title: string, byToken: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "续期通知小区",
      price: 260,
      owner_name: "续期业主",
      owner_phone: `1374${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    byToken
  );
  assert(house.ok, `create ${title}`);
  return data<any>(house).id;
}

function registerEntrustment(houseId: string, byToken: string, days = 60) {
  const start = new Date().toISOString();
  const end = new Date(Date.now() + days * 86400000).toISOString();
  const registered = app.call(
    "entrustment.register",
    {
      house_id: houseId,
      entrust_type: "exclusive",
      start_at: start,
      end_at: end,
      signed_at: start,
      remark: "续期通知测试",
    },
    byToken
  );
  assert(registered.ok, `register on ${houseId}`);
  return { id: data<any>(registered).id, end };
}

assert(
  !app.call(
    "entrustment.renew",
    { id: "missing", end_at: new Date(Date.now() + 90 * 86400000).toISOString() },
    peer
  ).ok,
  "peer cannot renew missing entrustment"
);

const houseId = createHouse("续期通知盘", agent);
const { id: entrustmentId, end: originalEnd } = registerEntrustment(houseId, agent, 60);
assert(
  !app.call(
    "entrustment.renew",
    { id: entrustmentId, end_at: new Date(Date.now() + 30 * 86400000).toISOString() },
    manager
  ).ok,
  "renew must extend original end date"
);

const renewedEnd = new Date(Date.now() + 120 * 86400000).toISOString();
const beforeAgent = renewMsgs(agent).length;
const beforeManager = renewMsgs(manager).length;
const renewed = app.call(
  "entrustment.renew",
  { id: entrustmentId, end_at: renewedEnd },
  manager
);
assert(renewed.ok, "manager renews agent entrustment");
assert(data<any>(renewed).end_at === renewedEnd, "renew returns new end_at");

const afterAgent = renewMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "agent receives renew message");
assert(afterAgent[0].ref_id === houseId, "message refs house");
assert(String(afterAgent[0].body).includes("续期通知盘"), "body has house title");
assert(
  String(afterAgent[0].body).includes(renewedEnd.slice(0, 10)),
  "body has new end date"
);
assert(renewMsgs(manager).length === beforeManager, "renewer does not self-notify");

const beforeSelf = renewMsgs(agent).length;
const selfEnd = new Date(Date.now() + 180 * 86400000).toISOString();
assert(
  app.call("entrustment.renew", { id: entrustmentId, end_at: selfEnd }, agent).ok,
  "agent renews own entrustment"
);
assert(renewMsgs(agent).length === beforeSelf, "self-renew skips notify");

const expiredHouseId = createHouse("过期后续期盘", agent);
const expired = registerEntrustment(expiredHouseId, agent, 10);
app.db
  .prepare(`UPDATE house_entrustments SET end_at=?, status='expired' WHERE id=?`)
  .run(new Date(Date.now() - 86400000).toISOString(), expired.id);
const expiredNewEnd = new Date(Date.now() + 90 * 86400000).toISOString();
const beforeExpired = renewMsgs(agent).length;
assert(
  app.call(
    "entrustment.renew",
    { id: expired.id, end_at: expiredNewEnd },
    manager
  ).ok,
  "manager renews expired entrustment"
);
assert(
  renewMsgs(agent).some(
    (m) =>
      m.ref_id === expiredHouseId &&
      String(m.body).includes(expiredNewEnd.slice(0, 10))
  ),
  "expired renew notifies creator/agent"
);
assert(renewMsgs(agent).length === beforeExpired + 1, "one message for expired renew");

const muteHouseId = createHouse("静音续期盘", agent);
const muted = registerEntrustment(muteHouseId, agent, 40);
assert(
  app.call("message.subscriptions.save", { channels: { house: false } }, agent).ok,
  "mute house channel"
);
const beforeMute = renewMsgs(agent).length;
assert(
  app.call(
    "entrustment.renew",
    {
      id: muted.id,
      end_at: new Date(Date.now() + 100 * 86400000).toISOString(),
    },
    manager
  ).ok,
  "renew while agent muted"
);
assert(renewMsgs(agent).length === beforeMute, "muted house suppresses renew message");

// keep originalEnd referenced for clarity in failures
assert(Boolean(originalEnd), "original end captured");

console.log(
  `Entrustment renew notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
