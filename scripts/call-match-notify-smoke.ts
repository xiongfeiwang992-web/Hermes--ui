import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "call-match-notify-smoke.db")).dbPath
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
const matchMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "business_record_status" &&
      String(m.title).includes("匹配到")
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const house = app.call(
  "house.create",
  {
    title: "来电匹配房源",
    deal_type: "sale",
    community: "匹配小区",
    price: 200,
    owner_name: "匹配业主",
    owner_phone: "13690001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "来电匹配客", phone: "13690002222", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");

const beforeAgent = matchMsgs(agent).length;
const beforeManager = matchMsgs(manager).length;
const houseCall = app.call(
  "officeCollab.calls.create",
  {
    phone: "13690001111",
    direction: "in",
    called_at: "2026-09-01T10:00:00.000Z",
    note: "业主来电",
  },
  manager
);
assert(houseCall.ok, "manager logs owner call");
assert(data<any>(houseCall).matched_house_id === data<any>(house).id, "matched house");
assert(matchMsgs(agent).length === beforeAgent + 1, "house agent receives match message");
assert(matchMsgs(manager).length === beforeManager, "logger does not self-notify");
assert(
  matchMsgs(agent).some(
    (m) =>
      m.ref_id === data<any>(houseCall).id &&
      m.title === "来电匹配到房源" &&
      String(m.body).includes("来电匹配房源")
  ),
  "house match message body"
);

const beforeCustomer = matchMsgs(agent).length;
const customerCall = app.call(
  "officeCollab.calls.create",
  {
    phone: "13690002222",
    direction: "out",
    called_at: "2026-09-01T11:00:00.000Z",
  },
  peer
);
assert(customerCall.ok, "peer logs customer call");
assert(
  data<any>(customerCall).matched_customer_id === data<any>(customer).id,
  "matched customer"
);
assert(matchMsgs(agent).length === beforeCustomer + 1, "customer agent receives match message");
assert(
  matchMsgs(agent).some(
    (m) =>
      m.ref_id === data<any>(customerCall).id &&
      m.title === "去电匹配到客源" &&
      String(m.body).includes("来电匹配客")
  ),
  "customer match message body"
);

const selfCallBefore = matchMsgs(agent).length;
assert(
  app.call(
    "officeCollab.calls.create",
    {
      phone: "13690001111",
      direction: "in",
      called_at: "2026-09-01T12:00:00.000Z",
    },
    agent
  ).ok,
  "agent logs own house call"
);
assert(matchMsgs(agent).length === selfCallBefore, "self logger skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const beforeMute = matchMsgs(agent).length;
assert(
  app.call(
    "officeCollab.calls.create",
    {
      phone: "13690002222",
      direction: "in",
      called_at: "2026-09-01T13:00:00.000Z",
    },
    manager
  ).ok,
  "call while muted"
);
assert(matchMsgs(agent).length === beforeMute, "muted other suppresses match message");

console.log(`Call match notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
