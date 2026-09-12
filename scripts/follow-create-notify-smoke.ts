import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "follow-create-notify-smoke.db")).dbPath
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
const followMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "follow_create" && m.title === "新增跟进记录"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const house = app.call(
  "house.create",
  {
    title: "跟进通知房源",
    deal_type: "sale",
    community: "跟进小区",
    price: 188,
    owner_name: "跟进业主",
    owner_phone: "13788001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const customer = app.call(
  "customer.create",
  {
    name: "跟进通知客",
    phone: "13788002222",
    intent: "buy",
    need: "三房刚需客",
  },
  agent
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const beforeAgent = followMsgs(agent).length;
const beforePeer = followMsgs(peer).length;
const houseFollow = app.call(
  "follow.create",
  {
    target_type: "house",
    target_id: houseId,
    content: "同行到访反馈采光不错",
    method: "visit",
  },
  peer
);
assert(houseFollow.ok, "peer follows house");
const houseFollowId = data<any>(houseFollow).id;
assert(followMsgs(agent).length === beforeAgent + 1, "holder receives house follow message");
assert(followMsgs(peer).length === beforePeer, "follower does not self-notify");
assert(
  followMsgs(agent).some(
    (m) =>
      m.ref_id === houseFollowId &&
      String(m.body).includes("跟进通知房源") &&
      String(m.body).includes("同行到访反馈采光不错")
  ),
  "house follow message body"
);

const beforeCust = followMsgs(agent).length;
const custFollow = app.call(
  "follow.create",
  {
    target_type: "customer",
    target_id: customerId,
    content: "电话沟通仍在看房",
    method: "phone",
  },
  manager
);
assert(custFollow.ok, "manager follows customer");
assert(
  followMsgs(agent).length === beforeCust + 1,
  "agent receives customer follow message"
);
assert(
  followMsgs(agent).some(
    (m) =>
      m.ref_id === data<any>(custFollow).id &&
      String(m.body).includes("跟进通知客") &&
      String(m.body).includes("电话沟通仍在看房")
  ),
  "customer follow message body"
);

const beforeSelf = followMsgs(agent).length;
assert(
  app.call(
    "follow.create",
    {
      target_type: "house",
      target_id: houseId,
      content: "接盘人自行补充跟进",
      method: "other",
    },
    agent
  ).ok,
  "holder self follow"
);
assert(followMsgs(agent).length === beforeSelf, "self follow skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { follow: false } }, agent).ok,
  "mute follow"
);
const beforeMute = followMsgs(agent).length;
assert(
  app.call(
    "follow.create",
    {
      target_type: "house",
      target_id: houseId,
      content: "静音期间他人跟进",
      method: "visit",
    },
    peer
  ).ok,
  "follow while muted"
);
assert(followMsgs(agent).length === beforeMute, "muted follow suppresses message");

void manager;
console.log(`Follow create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
