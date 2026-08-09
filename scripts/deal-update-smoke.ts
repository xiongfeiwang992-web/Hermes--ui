import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "deal-update-smoke.db")).dbPath);
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

const agent = login("agent_a");
const agentB = login("agent_b");
const manager = login("manager");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const house = app.call(
  "house.create",
  {
    title: "可编辑成交盘",
    deal_type: "sale",
    community: "编辑苑",
    price: 280,
    owner_name: "业主",
    owner_phone: "13680010001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;
const house2 = app.call(
  "house.create",
  {
    title: "替换成交盘",
    deal_type: "sale",
    community: "编辑苑",
    price: 300,
    owner_name: "业主乙",
    owner_phone: "13680010003",
    status: "available",
  },
  agent
);
assert(house2.ok, "create house2");
const house2Id = data<any>(house2).id;

const customer = app.call(
  "customer.create",
  { name: "可编辑客", phone: "13680010002", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const created = app.call(
  "deal.create",
  {
    house_id: houseId,
    customer_id: customerId,
    contract_price: 280,
    commission_owner: 18000,
    commission_customer: 12000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
    remark: "初稿",
  },
  agent
);
assert(created.ok, "create draft deal");
const dealId = data<any>(created).id;
assert(data<any>(created).status === "draft", "starts draft");

const updated = app.call(
  "deal.update",
  {
    id: dealId,
    house_id: house2Id,
    customer_id: customerId,
    contract_price: 295,
    commission_owner: 20000,
    commission_customer: 15000,
    remark: "改价后",
    loan_amount: 100,
    loan_bank: "本地银行",
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(updated.ok, "update draft");
const after = data<any>(updated);
assert(after.contract_price === 295, "price updated");
assert(after.commission_total === 35000, "commission total updated");
assert(after.house_id === house2Id, "house updated");
assert(after.remark === "改价后", "remark updated");
assert(after.loan_bank === "本地银行", "loan bank updated");

assert(
  !app.call(
    "deal.update",
    {
      id: dealId,
      commission_owner: 10000,
      commission_customer: 10000,
      commission_total: 25000,
    },
    agent
  ).ok,
  "reject bad commission sum"
);

assert(
  !app.call(
    "deal.update",
    {
      id: dealId,
      agent_ids: [agentId, agentBId],
      split_ratios: { [agentId]: 60, [agentBId]: 30 },
    },
    agent
  ).ok,
  "reject bad split sum"
);

assert(
  !app.call(
    "deal.update",
    {
      id: dealId,
      contract_price: 310,
      commission_owner: 20000,
      commission_customer: 15000,
    },
    agentB
  ).ok,
  "other agent cannot edit"
);

assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit");
assert(
  !app.call(
    "deal.update",
    {
      id: dealId,
      contract_price: 320,
      commission_owner: 20000,
      commission_customer: 15000,
    },
    agent
  ).ok,
  "cannot edit pending approval"
);

assert(app.call("deal.reject", { id: dealId, reason: "佣金结构需调整" }, manager).ok, "reject");
const afterReject = data<any>(app.call("deal.get", { id: dealId }, agent));
assert(afterReject.status === "rejected", "status rejected");

const fixRejected = app.call(
  "deal.update",
  {
    id: dealId,
    contract_price: 288,
    commission_owner: 16000,
    commission_customer: 14000,
    remark: "驳回后修正",
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(fixRejected.ok, "update rejected deal");
assert(data<any>(fixRejected).contract_price === 288, "rejected price fixed");
assert(data<any>(fixRejected).commission_total === 30000, "rejected commission fixed");

assert(app.call("deal.submit", { id: dealId }, agent).ok, "resubmit after edit");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve");
assert(
  !app.call(
    "deal.update",
    {
      id: dealId,
      contract_price: 1,
      commission_owner: 16000,
      commission_customer: 14000,
    },
    agent
  ).ok,
  "cannot edit approved"
);

console.log(`Deal update smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
