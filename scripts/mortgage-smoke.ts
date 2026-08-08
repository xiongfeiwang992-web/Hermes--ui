import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "mortgage-smoke.db")).dbPath);
let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const finance = login("finance");
const otherStore = login("agent_c");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

check(
  app.call(
    "transfer.templates.save",
    {
      deal_type: "sale",
      node_type: "loan",
      title: "银行贷款放款",
      sort_order: 1,
      default_assignee_role: "agent",
    },
    admin
  ).ok,
  "save loan transfer template"
);
const house = app.call(
  "house.create",
  {
    title: "按揭测试房源",
    deal_type: "sale",
    community: "按揭小区",
    price: 260,
    owner_name: "按揭业主",
    owner_phone: "13760000001",
    status: "available",
  },
  agent
);
check(house.ok, "create mortgage house");
const customer = app.call(
  "customer.create",
  { name: "按揭客户", phone: "13860000001", intent: "buy" },
  agent
);
check(customer.ok, "create mortgage customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 250,
    commission_owner: 10000,
    commission_customer: 10000,
    loan_amount: 150,
    loan_bank: "本地测试银行",
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
check(deal.ok, "create deal with automatic mortgage");
const dealId = data<any>(deal).id;
const initial = app.call("mortgage.get", { deal_id: dealId }, agent);
check(
  initial.ok &&
    data<any>(initial).status === "draft" &&
    data<any>(initial).amount === 150,
  "initialize mortgage from deal loan fields"
);
check(
  app.call(
    "mortgage.upsert",
    { deal_id: dealId, bank: "更新测试银行", amount: 145, remark: "首套贷款" },
    agent
  ).ok,
  "agent updates draft mortgage"
);
check(
  app.call("mortgage.status", { deal_id: dealId, status: "applied" }, agent).ok,
  "agent submits mortgage application"
);
check(
  !app.call(
    "mortgage.upsert",
    { deal_id: dealId, bank: "不可修改银行", amount: 140 },
    agent
  ).ok,
  "applied mortgage fields are locked"
);
check(app.call("deal.submit", { id: dealId }, agent).ok, "submit mortgage deal");
check(app.call("deal.approve", { id: dealId }, manager).ok, "approve mortgage deal");
const nodes = app.call("transfer.list", { deal_id: dealId }, agent);
const loanNode = nodes.ok
  ? data<any[]>(nodes).find((node) => node.node_type === "loan")
  : null;
check(Boolean(loanNode), "approval creates loan transfer node");
check(
  !app.call("transfer.status", { id: loanNode.id, status: "completed" }, agent).ok,
  "loan node cannot complete before mortgage approval"
);
check(
  !app.call(
    "mortgage.status",
    { deal_id: dealId, status: "rejected", reason: "" },
    manager
  ).ok,
  "mortgage rejection requires reason"
);
check(
  app.call("mortgage.status", { deal_id: dealId, status: "approved" }, manager).ok,
  "manager approves mortgage"
);
check(
  app.call("transfer.status", { id: loanNode.id, status: "in_progress" }, agent).ok,
  "start approved loan node"
);
check(
  app.call("transfer.status", { id: loanNode.id, status: "completed" }, agent).ok,
  "complete approved loan node"
);
const disbursed = app.call("mortgage.get", { deal_id: dealId }, finance);
check(
  disbursed.ok &&
    data<any>(disbursed).status === "disbursed" &&
    Boolean(data<any>(disbursed).disbursed_at),
  "loan node completion marks mortgage disbursed"
);
check(
  !app.call("mortgage.get", { deal_id: dealId }, otherStore).ok,
  "mortgage preserves store isolation"
);
const messages = app.call("message.list", {}, agent);
check(
  messages.ok &&
    data<any[]>(messages).some((message) => message.kind === "mortgage_status"),
  "mortgage status sends in-app message"
);

console.log(`Mortgage smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
