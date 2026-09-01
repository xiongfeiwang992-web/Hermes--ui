import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "exclusive-update-notify-smoke.db")).dbPath
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
const packageMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "包销资料已更新"
  );
const exclusiveMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "独家代理资料已更新"
  );

const manager = login("manager");
const agent = login("agent_a");

const house = app.call(
  "house.create",
  {
    title: "包销更新通知盘",
    deal_type: "sale",
    community: "包销更新苑",
    price: 300,
    owner_name: "包销业主",
    owner_phone: "13768001111",
    status: "available",
  },
  agent
);
assert(house.ok, "agent creates house");
const houseId = data<any>(house).id;

assert(
  app.call(
    "propertyExt.exclusive.save",
    {
      house_id: houseId,
      agency_type: "package",
      start_date: "2026-09-01",
      end_date: "2027-09-01",
      package_price: 280,
    },
    manager
  ).ok,
  "manager registers package profile"
);

const beforeAgent = packageMsgs(agent).length;
const beforeManager = packageMsgs(manager).length;
const updated = app.call(
  "propertyExt.exclusive.save",
  {
    house_id: houseId,
    agency_type: "package",
    start_date: "2026-09-01",
    end_date: "2027-10-01",
    package_price: 285,
  },
  manager
);
assert(updated.ok, "manager updates package profile");
assert(packageMsgs(agent).length === beforeAgent + 1, "agent receives package update message");
assert(packageMsgs(manager).length === beforeManager, "manager actor skips self");
assert(
  packageMsgs(agent).some(
    (m) =>
      m.ref_id === houseId &&
      m.ref_type === "house_exclusive_profile" &&
      String(m.body).includes("包销更新通知盘") &&
      String(m.body).includes("2027-10-01")
  ),
  "package update message body"
);

const exclusiveHouse = app.call(
  "house.create",
  {
    title: "独家更新通知盘",
    deal_type: "sale",
    community: "独家更新苑",
    price: 240,
    owner_name: "独家业主",
    owner_phone: "13768002222",
    status: "available",
  },
  agent
);
assert(exclusiveHouse.ok, "create exclusive house");
const exclusiveId = data<any>(exclusiveHouse).id;
assert(
  app.call(
    "propertyExt.exclusive.save",
    {
      house_id: exclusiveId,
      agency_type: "exclusive",
      start_date: "2026-09-01",
      end_date: "2027-03-01",
    },
    manager
  ).ok,
  "manager registers exclusive profile"
);
const beforeExclusive = exclusiveMsgs(agent).length;
assert(
  app.call(
    "propertyExt.exclusive.save",
    {
      house_id: exclusiveId,
      agency_type: "exclusive",
      start_date: "2026-09-01",
      end_date: "2027-04-01",
    },
    manager
  ).ok,
  "manager updates exclusive profile"
);
assert(
  exclusiveMsgs(agent).length === beforeExclusive + 1,
  "agent receives exclusive update message"
);

const beforeSelf = packageMsgs(agent).length;
assert(
  app.call(
    "propertyExt.exclusive.save",
    {
      house_id: houseId,
      agency_type: "package",
      start_date: "2026-09-01",
      end_date: "2027-11-01",
      package_price: 290,
    },
    agent
  ).ok,
  "agent updates own package"
);
assert(packageMsgs(agent).length === beforeSelf, "agent skips self-notify on own house");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const beforeMute = packageMsgs(agent).length;
assert(
  app.call(
    "propertyExt.exclusive.save",
    {
      house_id: houseId,
      agency_type: "package",
      start_date: "2026-09-01",
      end_date: "2027-12-01",
      package_price: 295,
    },
    manager
  ).ok,
  "update while muted"
);
assert(packageMsgs(agent).length === beforeMute, "muted other suppresses update message");

console.log(`Exclusive update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
