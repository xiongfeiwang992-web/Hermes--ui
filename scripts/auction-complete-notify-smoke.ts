import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "auction-complete-notify-smoke.db")).dbPath
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
const completeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "房源拍卖已完成"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

let phoneSeq = 500;
function createActiveAuction(opts: {
  title: string;
  byToken: string;
  caseNo?: string | null;
}) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title: opts.title,
      deal_type: "sale",
      community: "拍卖完成小区",
      price: 320,
      owner_name: "拍卖业主",
      owner_phone: `1377${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    opts.byToken
  );
  assert(house.ok, `create house ${opts.title}`);
  const houseId = data<any>(house).id;
  const payload: any = {
    house_id: houseId,
    court_name: "本地中院",
    starting_price: 210,
    reserve_price: 230,
  };
  if (opts.caseNo !== null) payload.case_no = opts.caseNo || `拍通-${phoneSeq}`;
  assert(
    app.call("propertyExt.auction.save", payload, opts.byToken).ok,
    `save auction ${opts.title}`
  );
  assert(
    app.call("propertyExt.auction.activate", { house_id: houseId }, opts.byToken).ok,
    `activate auction ${opts.title}`
  );
  return { houseId, caseNo: payload.case_no as string | undefined };
}

assert(
  !app.call("propertyExt.auction.complete", { house_id: "missing" }, manager).ok,
  "cannot complete missing auction"
);

const { houseId, caseNo } = createActiveAuction({
  title: "拍卖完成通知盘",
  byToken: agent,
  caseNo: "拍2026-通-1",
});
const beforeAgent = completeMsgs(agent).length;
const beforeManager = completeMsgs(manager).length;
const completed = app.call(
  "propertyExt.auction.complete",
  { house_id: houseId },
  manager
);
assert(completed.ok, "manager completes agent auction");
assert(data<any>(completed).status === "completed", "status completed");

const afterAgent = completeMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "agent receives complete message");
assert(afterAgent[0].ref_id === houseId, "message refs house");
assert(String(afterAgent[0].body).includes("拍卖完成通知盘"), "body has house title");
assert(String(afterAgent[0].body).includes(caseNo!), "body has case no");
assert(completeMsgs(manager).length === beforeManager, "completer does not self-notify");
assert(
  !app.call("propertyExt.auction.complete", { house_id: houseId }, manager).ok,
  "cannot complete twice"
);

const self = createActiveAuction({
  title: "自行完成拍卖盘",
  byToken: agent,
  caseNo: "拍2026-自-2",
});
const beforeSelf = completeMsgs(agent).length;
assert(
  app.call("propertyExt.auction.complete", { house_id: self.houseId }, agent).ok,
  "agent completes own auction"
);
assert(completeMsgs(agent).length === beforeSelf, "self-complete does not notify agent");

const noCase = createActiveAuction({
  title: "未填编号完成盘",
  byToken: agent,
  caseNo: null,
});
const beforeNoCase = completeMsgs(agent).length;
assert(
  app.call("propertyExt.auction.complete", { house_id: noCase.houseId }, manager).ok,
  "complete auction without case no"
);
const noCaseMsgs = completeMsgs(agent);
assert(noCaseMsgs.length === beforeNoCase + 1, "agent notified without case no");
assert(
  noCaseMsgs.some(
    (m) =>
      m.ref_id === noCase.houseId &&
      String(m.body).includes("未填编号完成盘") &&
      !String(m.body).includes(" · 案号 ")
  ),
  "body omits case no when empty"
);

const crossHouse = app.call(
  "house.create",
  {
    title: "店长建档拍卖盘",
    deal_type: "sale",
    community: "拍卖完成小区",
    price: 300,
    owner_name: "店长建档业主",
    owner_phone: "13770000099",
    status: "available",
  },
  agent
);
assert(crossHouse.ok, "create house for manager-saved auction");
const crossHouseId = data<any>(crossHouse).id;
assert(
  app.call(
    "propertyExt.auction.save",
    {
      house_id: crossHouseId,
      court_name: "本地中院",
      case_no: "拍2026-店-4",
      starting_price: 180,
    },
    manager
  ).ok,
  "manager saves auction on agent house"
);
assert(
  app.call("propertyExt.auction.activate", { house_id: crossHouseId }, manager).ok,
  "manager activates auction on agent house"
);
const beforeCrossAgent = completeMsgs(agent).length;
const beforeCrossManager = completeMsgs(manager).length;
const beforeCrossPeer = completeMsgs(peer).length;
assert(
  app.call("propertyExt.auction.complete", { house_id: crossHouseId }, peer).ok === false,
  "peer cannot complete other agent auction"
);
assert(
  app.call("propertyExt.auction.complete", { house_id: crossHouseId }, agent).ok,
  "agent completes manager-created auction profile"
);
assert(
  completeMsgs(agent).length === beforeCrossAgent,
  "agent completer does not self-notify"
);
assert(
  completeMsgs(manager).length === beforeCrossManager + 1,
  "auction creator manager receives complete message"
);
assert(completeMsgs(peer).length === beforeCrossPeer, "unrelated peer not notified");
assert(
  completeMsgs(manager).some(
    (m) => m.ref_id === crossHouseId && String(m.body).includes("拍2026-店-4")
  ),
  "creator message includes case no"
);

const muted = createActiveAuction({
  title: "静音完成拍卖盘",
  byToken: agent,
  caseNo: "拍2026-静-5",
});
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other channel"
);
const beforeMute = completeMsgs(agent).length;
assert(
  app.call("propertyExt.auction.complete", { house_id: muted.houseId }, manager).ok,
  "complete while agent muted"
);
assert(completeMsgs(agent).length === beforeMute, "muted other suppresses complete message");

console.log(`Auction complete notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
