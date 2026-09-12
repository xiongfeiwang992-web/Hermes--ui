import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "deal-signoff-notify-smoke.db")).dbPath
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
const signMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "成交签署确认"
  );

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const managerName = data<any>(app.call("auth.me", {}, manager)).display_name;

const house = app.call(
  "house.create",
  {
    title: "签署通知房源",
    deal_type: "sale",
    community: "签署小区",
    price: 200,
    owner_name: "签署业主",
    owner_phone: "13721000001",
    status: "available",
  },
  agentA
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "签署客户", phone: "13821000001", intent: "buy" },
  agentA
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 188.5,
    commission_owner: 10000,
    commission_customer: 8000,
    agent_ids: [agentAId, agentBId],
    split_ratios: { [agentAId]: 60, [agentBId]: 40 },
  },
  agentA
);
assert(deal.ok, "create multi-agent deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agentA).ok, "submit deal");

assert(
  !app.call(
    "contract.sign",
    { deal_id: dealId, statement: "短" },
    manager
  ).ok,
  "statement min length"
);
assert(
  !app.call(
    "contract.sign",
    { deal_id: dealId, statement: "财务不可签署确认成交" },
    finance
  ).ok,
  "finance cannot sign"
);

const beforeA = signMsgs(agentA).length;
const beforeB = signMsgs(agentB).length;
const beforeM = signMsgs(manager).length;
const signed = app.call(
  "contract.sign",
  { deal_id: dealId, statement: "本人确认成交内容真实无误" },
  manager
);
assert(signed.ok, "manager signs deal");
assert(Boolean(data<any>(signed).signed_at), "returns signed_at");
assert(data<any>(signed).legal_ca === false, "local signoff not CA");

assert(signMsgs(agentA).length === beforeA + 1, "agent_a receives sign message");
assert(signMsgs(agentB).length === beforeB + 1, "agent_b receives sign message");
assert(signMsgs(manager).length === beforeM, "signer does not self-notify");
assert(
  signMsgs(agentA).some(
    (m) =>
      m.ref_id === dealId &&
      String(m.body).includes(managerName) &&
      String(m.body).includes("188.50")
  ),
  "message has signer and contract price"
);

const beforeSelf = signMsgs(agentA).length;
const beforeB2 = signMsgs(agentB).length;
assert(
  app.call(
    "contract.sign",
    { deal_id: dealId, statement: "分成经纪人本人再次确认" },
    agentA
  ).ok,
  "agent_a signs own deal"
);
assert(signMsgs(agentA).length === beforeSelf, "self-sign skips notify");
assert(signMsgs(agentB).length === beforeB2 + 1, "co-agent still notified on peer sign");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agentB).ok,
  "mute other channel"
);
const beforeMute = signMsgs(agentB).length;
assert(
  app.call(
    "contract.sign",
    { deal_id: dealId, statement: "静音场景店长再签一次" },
    manager
  ).ok,
  "sign while co-agent muted"
);
assert(signMsgs(agentB).length === beforeMute, "muted other suppresses sign message");

console.log(`Deal signoff notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
