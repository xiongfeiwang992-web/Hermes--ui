import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "auction-create-notify-smoke.db")).dbPath
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
const createMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "拍卖资料已登记"
  );

const manager = login("manager");
const agent = login("agent_a");

const house = app.call(
  "house.create",
  {
    title: "拍卖登记通知盘",
    deal_type: "sale",
    community: "拍卖通知苑",
    price: 260,
    owner_name: "拍卖业主",
    owner_phone: "13766001111",
    status: "available",
  },
  agent
);
assert(house.ok, "agent creates house");
const houseId = data<any>(house).id;

const beforeAgent = createMsgs(agent).length;
const beforeManager = createMsgs(manager).length;
const saved = app.call(
  "propertyExt.auction.save",
  {
    house_id: houseId,
    court_name: "通知法院",
    case_no: "拍通-1",
    starting_price: 210,
    reserve_price: 230,
  },
  manager
);
assert(saved.ok, "manager registers auction profile");
assert(createMsgs(agent).length === beforeAgent + 1, "agent receives auction create message");
assert(createMsgs(manager).length === beforeManager, "manager actor skips self");
assert(
  createMsgs(agent).some(
    (m) =>
      m.ref_id === houseId &&
      String(m.body).includes("拍卖登记通知盘") &&
      String(m.body).includes("210")
  ),
  "auction create message body"
);

const beforeUpdate = createMsgs(agent).length;
assert(
  app.call(
    "propertyExt.auction.save",
    {
      house_id: houseId,
      court_name: "通知法院",
      case_no: "拍通-1",
      starting_price: 215,
      reserve_price: 235,
    },
    manager
  ).ok,
  "manager updates auction profile"
);
assert(createMsgs(agent).length === beforeUpdate, "update does not re-notify");

const own = app.call(
  "house.create",
  {
    title: "自登拍卖盘",
    deal_type: "sale",
    community: "自登拍卖苑",
    price: 180,
    owner_name: "自登业主",
    owner_phone: "13766002222",
    status: "available",
  },
  agent
);
assert(own.ok, "agent creates own house");
const beforeSelf = createMsgs(agent).length;
assert(
  app.call(
    "propertyExt.auction.save",
    { house_id: data<any>(own).id, starting_price: 150, court_name: "自登法院" },
    agent
  ).ok,
  "agent registers own auction"
);
assert(createMsgs(agent).length === beforeSelf, "agent skips self-notify on own house");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const muteHouse = app.call(
  "house.create",
  {
    title: "静音拍卖盘",
    deal_type: "sale",
    community: "静音拍卖苑",
    price: 190,
    owner_name: "静音业主",
    owner_phone: "13766003333",
    status: "available",
  },
  agent
);
assert(muteHouse.ok, "create mute house");
const beforeMute = createMsgs(agent).length;
assert(
  app.call(
    "propertyExt.auction.save",
    { house_id: data<any>(muteHouse).id, starting_price: 160, court_name: "静音法院" },
    manager
  ).ok,
  "register while muted"
);
assert(createMsgs(agent).length === beforeMute, "muted other suppresses message");

console.log(`Auction create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
