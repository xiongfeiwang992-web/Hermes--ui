import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "earnest-create-notify-smoke.db")).dbPath
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
const earnestMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "earnest_create" && m.title === "意向金已登记"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const house = app.call(
  "house.create",
  {
    title: "意向金通知房源",
    deal_type: "sale",
    community: "意向金小区",
    price: 260,
    owner_name: "意向金业主",
    owner_phone: "13755001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const customer = app.call(
  "customer.create",
  {
    name: "意向金通知客",
    phone: "13755002222",
    intent: "buy",
    need: "意向金测试客",
  },
  peer
);
assert(customer.ok, "peer creates customer");
const customerId = data<any>(customer).id;

const beforeAgent = earnestMsgs(agent).length;
const beforePeer = earnestMsgs(peer).length;
const beforeManager = earnestMsgs(manager).length;
const created = app.call(
  "earnest.create",
  {
    customer_id: customerId,
    house_id: houseId,
    amount: 20000,
    method: "transfer",
  },
  manager
);
assert(created.ok, "manager creates earnest");
const earnestId = data<any>(created).id;
assert(earnestMsgs(agent).length === beforeAgent + 1, "house agent receives message");
assert(earnestMsgs(peer).length === beforePeer + 1, "customer agent receives message");
assert(earnestMsgs(manager).length === beforeManager, "creator does not self-notify");
assert(
  earnestMsgs(agent).some(
    (m) =>
      m.ref_id === earnestId &&
      String(m.body).includes("意向金通知客") &&
      String(m.body).includes("意向金通知房源") &&
      String(m.body).includes("20000")
  ),
  "earnest message body"
);

const selfHouse = app.call(
  "house.create",
  {
    title: "自登记意向金房",
    deal_type: "sale",
    community: "意向金小区",
    price: 250,
    owner_name: "自行业主",
    owner_phone: "13755003333",
    status: "available",
  },
  agent
);
assert(selfHouse.ok, "agent creates self house");
const selfCustomer = app.call(
  "customer.create",
  {
    name: "自登记意向金客",
    phone: "13755004444",
    intent: "buy",
    need: "自登记客",
  },
  agent
);
assert(selfCustomer.ok, "agent creates self customer");
const beforeSelf = earnestMsgs(agent).length;
assert(
  app.call(
    "earnest.create",
    {
      customer_id: data<any>(selfCustomer).id,
      house_id: data<any>(selfHouse).id,
      amount: 10000,
      method: "cash",
    },
    agent
  ).ok,
  "agent self earnest"
);
assert(earnestMsgs(agent).length === beforeSelf, "self earnest skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { payment: false } }, agent).ok,
  "mute payment"
);
const beforeMute = earnestMsgs(agent).length;
const beforeMutePeer = earnestMsgs(peer).length;
const mutedCustomer = app.call(
  "customer.create",
  {
    name: "静音意向金客",
    phone: "13755005555",
    intent: "buy",
    need: "静音客",
  },
  peer
);
assert(mutedCustomer.ok, "peer creates muted customer");
assert(
  app.call(
    "earnest.create",
    {
      customer_id: data<any>(mutedCustomer).id,
      house_id: houseId,
      amount: 15000,
      method: "transfer",
    },
    manager
  ).ok,
  "earnest while muted"
);
assert(earnestMsgs(agent).length === beforeMute, "muted payment suppresses house-agent message");
assert(
  earnestMsgs(peer).length === beforeMutePeer + 1,
  "customer agent still receives when house agent muted"
);

console.log(`Earnest create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
