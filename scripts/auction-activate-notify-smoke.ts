import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "auction-activate-notify-smoke.db")).dbPath
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
const activateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "拍卖已启用"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

let phoneSeq = 900;
function prepareDraft(title: string, byToken: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "拍卖启用通知小区",
      price: 320,
      owner_name: "拍卖业主",
      owner_phone: `1379${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    byToken
  );
  assert(house.ok, `create ${title}`);
  const houseId = data<any>(house).id;
  assert(
    app.call(
      "propertyExt.auction.save",
      {
        house_id: houseId,
        court_name: "测试法院",
        case_no: `AU-${phoneSeq}`,
        starting_price: 200,
        reserve_price: 220,
        remark: "启用通知测试",
      },
      byToken
    ).ok,
    `save ${title}`
  );
  return houseId;
}

const houseId = prepareDraft("拍卖启用通知盘", agent);
assert(
  !app.call("propertyExt.auction.activate", { house_id: houseId }, peer).ok,
  "peer cannot activate other agent auction"
);

const beforeAgent = activateMsgs(agent).length;
const beforeManager = activateMsgs(manager).length;
const activated = app.call(
  "propertyExt.auction.activate",
  { house_id: houseId },
  manager
);
assert(activated.ok, "manager activates auction");
assert(data<any>(activated).status === "active", "status active");
const afterAgent = activateMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "agent receives activate message");
assert(afterAgent.some((m) => m.ref_id === houseId), "message refs house");
assert(
  afterAgent.some(
    (m) => m.ref_id === houseId && String(m.body).includes("拍卖启用通知盘")
  ),
  "body has house title"
);
assert(activateMsgs(manager).length === beforeManager, "activator does not self-notify");
assert(
  !app.call("propertyExt.auction.activate", { house_id: houseId }, manager).ok,
  "cannot activate twice"
);

const selfId = prepareDraft("自行启用拍卖盘", agent);
const beforeSelf = activateMsgs(agent).length;
assert(
  app.call("propertyExt.auction.activate", { house_id: selfId }, agent).ok,
  "agent activates own auction"
);
assert(activateMsgs(agent).length === beforeSelf, "self-activate skips notify");

const mutedId = prepareDraft("静音启用拍卖盘", agent);
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other channel"
);
const beforeMute = activateMsgs(agent).length;
assert(
  app.call("propertyExt.auction.activate", { house_id: mutedId }, manager).ok,
  "activate while muted"
);
assert(activateMsgs(agent).length === beforeMute, "muted other suppresses activate message");

console.log(
  `Auction activate notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
