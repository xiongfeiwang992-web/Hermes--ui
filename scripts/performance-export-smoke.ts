import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "performance-export-smoke.db")).dbPath);
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

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const otherStore = login("agent_c");
const finance = login("finance");
const month = new Date().toISOString().slice(0, 7);

const house = app.call(
  "house.create",
  {
    title: "业绩导出房源",
    deal_type: "sale",
    community: "业绩苑",
    price: 400,
    owner_name: "业主",
    owner_phone: "13770005501",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "业绩导出客户", phone: "13770005502", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");

const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 400,
    commission_owner: 20000,
    commission_customer: 10000,
    agent_ids: [
      data<any>(app.call("auth.me", {}, agent)).id,
      data<any>(app.call("auth.me", {}, peer)).id,
    ],
    split_ratios: {
      [data<any>(app.call("auth.me", {}, agent)).id]: 60,
      [data<any>(app.call("auth.me", {}, peer)).id]: 40,
    },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve deal");

const commissions = data<any[]>(app.call("commission.list", {}, agent));
assert(commissions.some((row) => row.deal_id === dealId), "agent sees own commission");

const csv = app.call("report.commissionsCsv", { month }, agent);
assert(csv.ok, "agent export commissions csv");
const content = data<any>(csv).content as string;
assert(content.startsWith("\uFEFF"), "commissions csv bom");
assert(content.includes("经纪人甲"), "commissions csv has agent name");
assert(content.includes("业绩导出房源"), "commissions csv has house title");
assert(content.includes(dealId), "commissions csv has deal id");
assert(!content.includes("经纪人乙") || content.includes("经纪人甲"), "agent csv scoped");
// agent should only see own rows
assert(
  !content.includes("经纪人乙"),
  "agent commissions csv excludes peer"
);

const peerCsv = app.call("report.commissionsCsv", { month }, peer);
assert(peerCsv.ok && data<any>(peerCsv).content.includes("经纪人乙"), "peer export own commission");
assert(!data<any>(peerCsv).content.includes("经纪人甲"), "peer csv excludes agent_a");

const managerCsv = app.call("report.commissionsCsv", { month }, manager);
assert(managerCsv.ok, "manager export commissions");
assert(
  data<any>(managerCsv).content.includes("经纪人甲") &&
    data<any>(managerCsv).content.includes("经纪人乙"),
  "manager sees store commissions"
);

const otherCsv = app.call("report.commissionsCsv", { month }, otherStore);
assert(otherCsv.ok && data<any>(otherCsv).rows === 0, "other store sees no rows");

const financeCsv = app.call("report.commissionsCsv", { month }, finance);
assert(
  financeCsv.ok && data<any>(financeCsv).content.includes("经纪人甲"),
  "finance can export commissions"
);

const ranking = app.call("report.performanceCsv", { month }, manager);
assert(ranking.ok, "export performance ranking");
const rankContent = data<any>(ranking).content as string;
assert(rankContent.includes("名次"), "ranking header");
assert(rankContent.includes("经纪人甲"), "ranking includes agent");
assert(rankContent.includes("经纪人乙"), "ranking includes peer");
assert(data<any>(ranking).filename.includes(month), "ranking filename uses month");

const agentRank = app.call("report.performanceCsv", { month }, agent);
assert(agentRank.ok, "agent export ranking");
assert(
  data<any>(agentRank).content.includes("经纪人甲") &&
    !data<any>(agentRank).content.includes("经纪人乙"),
  "agent ranking scoped to self"
);

const emptyMonth = app.call("report.commissionsCsv", { month: "2099-01" }, admin);
assert(emptyMonth.ok && data<any>(emptyMonth).rows === 0, "future month empty");

console.log(`Performance export smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
