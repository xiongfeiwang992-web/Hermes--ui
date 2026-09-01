import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "exclusive-create-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "包销资料已登记"
  );
const exclusiveMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "独家代理资料已登记"
  );

const manager = login("manager");
const agent = login("agent_a");

const house = app.call(
  "house.create",
  {
    title: "包销登记通知盘",
    deal_type: "sale",
    community: "包销通知苑",
    price: 300,
    owner_name: "包销业主",
    owner_phone: "13767001111",
    status: "available",
  },
  agent
);
assert(house.ok, "agent creates house");
const houseId = data<any>(house).id;

const beforeAgent = packageMsgs(agent).length;
const beforeManager = packageMsgs(manager).length;
const saved = app.call(
  "propertyExt.exclusive.save",
  {
    house_id: houseId,
    agency_type: "package",
    start_date: "2026-09-01",
    end_date: "2027-09-01",
    package_price: 280,
    commission_rule: "差价归门店",
  },
  manager
);
assert(saved.ok, "manager registers package profile");
assert(packageMsgs(agent).length === beforeAgent + 1, "agent receives package create message");
assert(packageMsgs(manager).length === beforeManager, "manager actor skips self");
assert(
  packageMsgs(agent).some(
    (m) =>
      m.ref_id === houseId &&
      String(m.body).includes("包销登记通知盘") &&
      String(m.body).includes("2026-09-01")
  ),
  "package create message body"
);

const beforeUpdate = packageMsgs(agent).length;
assert(
  app.call(
    "propertyExt.exclusive.save",
    {
      house_id: houseId,
      agency_type: "package",
      start_date: "2026-09-01",
      end_date: "2027-10-01",
      package_price: 285,
    },
    manager
  ).ok,
  "manager updates package profile"
);
assert(packageMsgs(agent).length === beforeUpdate, "update does not re-notify");

const exclusiveHouse = app.call(
  "house.create",
  {
    title: "独家登记通知盘",
    deal_type: "sale",
    community: "独家通知苑",
    price: 240,
    owner_name: "独家业主",
    owner_phone: "13767002222",
    status: "available",
  },
  agent
);
assert(exclusiveHouse.ok, "create exclusive house");
const beforeExclusive = exclusiveMsgs(agent).length;
assert(
  app.call(
    "propertyExt.exclusive.save",
    {
      house_id: data<any>(exclusiveHouse).id,
      agency_type: "exclusive",
      start_date: "2026-09-01",
      end_date: "2027-03-01",
    },
    manager
  ).ok,
  "manager registers exclusive profile"
);
assert(
  exclusiveMsgs(agent).length === beforeExclusive + 1,
  "agent receives exclusive create message"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const muteHouse = app.call(
  "house.create",
  {
    title: "静音包销盘",
    deal_type: "sale",
    community: "静音包销苑",
    price: 200,
    owner_name: "静音业主",
    owner_phone: "13767003333",
    status: "available",
  },
  agent
);
assert(muteHouse.ok, "create mute house");
const beforeMute = packageMsgs(agent).length;
assert(
  app.call(
    "propertyExt.exclusive.save",
    {
      house_id: data<any>(muteHouse).id,
      agency_type: "package",
      start_date: "2026-09-01",
      end_date: "2027-09-01",
      package_price: 180,
    },
    manager
  ).ok,
  "register while muted"
);
assert(packageMsgs(agent).length === beforeMute, "muted other suppresses message");

console.log(`Exclusive create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
