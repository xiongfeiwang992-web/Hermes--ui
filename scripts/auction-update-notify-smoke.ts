import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "auction-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "拍卖资料已更新"
  );

const manager = login("manager");
const agent = login("agent_a");

const house = app.call(
  "house.create",
  {
    title: "拍卖更新通知盘",
    deal_type: "sale",
    community: "拍卖更新苑",
    price: 260,
    owner_name: "拍卖业主",
    owner_phone: "13767001111",
    status: "available",
  },
  agent
);
assert(house.ok, "agent creates house");
const houseId = data<any>(house).id;

assert(
  app.call(
    "propertyExt.auction.save",
    {
      house_id: houseId,
      court_name: "更新法院",
      case_no: "拍更-1",
      starting_price: 210,
      reserve_price: 230,
    },
    manager
  ).ok,
  "manager registers auction profile"
);

const beforeAgent = updateMsgs(agent).length;
const beforeManager = updateMsgs(manager).length;
const updated = app.call(
  "propertyExt.auction.save",
  {
    house_id: houseId,
    court_name: "更新法院",
    case_no: "拍更-1",
    starting_price: 220,
    reserve_price: 240,
  },
  manager
);
assert(updated.ok, "manager updates auction profile");
assert(updateMsgs(agent).length === beforeAgent + 1, "agent receives auction update message");
assert(updateMsgs(manager).length === beforeManager, "manager actor skips self");
assert(
  updateMsgs(agent).some(
    (m) =>
      m.ref_id === houseId &&
      m.ref_type === "house_auction_profile" &&
      String(m.body).includes("拍卖更新通知盘") &&
      String(m.body).includes("220")
  ),
  "auction update message body"
);

const beforeSelf = updateMsgs(agent).length;
assert(
  app.call(
    "propertyExt.auction.save",
    {
      house_id: houseId,
      court_name: "更新法院",
      case_no: "拍更-1",
      starting_price: 225,
      reserve_price: 245,
    },
    agent
  ).ok,
  "agent updates own auction"
);
assert(updateMsgs(agent).length === beforeSelf, "agent skips self-notify on own house");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const beforeMute = updateMsgs(agent).length;
assert(
  app.call(
    "propertyExt.auction.save",
    {
      house_id: houseId,
      court_name: "静音法院",
      case_no: "拍更-静",
      starting_price: 230,
      reserve_price: 250,
    },
    manager
  ).ok,
  "update while muted"
);
assert(updateMsgs(agent).length === beforeMute, "muted other suppresses update message");

console.log(`Auction update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
