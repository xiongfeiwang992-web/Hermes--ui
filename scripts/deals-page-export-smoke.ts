import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "deals-page-export-smoke.db")).dbPath);
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
const finance = login("finance");
const agent = login("agent_a");
const otherStore = login("agent_c");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

const houseA = app.call(
  "house.create",
  {
    title: "成交导出翠湖A",
    deal_type: "sale",
    community: "翠湖苑",
    price: 210,
    owner_name: "业主甲",
    owner_phone: "13780001001",
    status: "available",
  },
  agent
);
assert(houseA.ok, "create house A");
const houseB = app.call(
  "house.create",
  {
    title: "成交导出别苑B",
    deal_type: "sale",
    community: "别苑",
    price: 180,
    owner_name: "业主乙",
    owner_phone: "13780001002",
    status: "available",
  },
  agent
);
assert(houseB.ok, "create house B");
const customerA = app.call(
  "customer.create",
  { name: "成交导出客甲", phone: "13780002001", intent: "buy" },
  agent
);
assert(customerA.ok, "create customer A");
const customerB = app.call(
  "customer.create",
  { name: "成交导出客乙", phone: "13780002002", intent: "buy" },
  agent
);
assert(customerB.ok, "create customer B");

const draft = app.call(
  "deal.create",
  {
    house_id: data<any>(houseA).id,
    customer_id: data<any>(customerA).id,
    contract_price: 210,
    commission_owner: 10000,
    commission_customer: 8000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
    remark: "草稿备注",
  },
  agent
);
assert(draft.ok, "create draft deal");
const draftId = data<any>(draft).id;

const approved = app.call(
  "deal.create",
  {
    house_id: data<any>(houseB).id,
    customer_id: data<any>(customerB).id,
    contract_price: 180,
    commission_owner: 9000,
    commission_customer: 7000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(approved.ok, "create approve deal");
const approvedId = data<any>(approved).id;
assert(app.call("deal.submit", { id: approvedId }, agent).ok, "submit deal");
assert(app.call("deal.approve", { id: approvedId }, manager).ok, "approve deal");

const listed = app.call("deal.list", {}, agent);
assert(
  listed.ok &&
    data<any[]>(listed).some((row) => row.id === draftId && row.house_title === "成交导出翠湖A") &&
    data<any[]>(listed).some((row) => row.id === approvedId && row.customer_name === "成交导出客乙"),
  "list enriches house/customer names"
);

const statusDraft = app.call("deal.list", { status: "draft" }, agent);
assert(
  statusDraft.ok &&
    data<any[]>(statusDraft).some((row) => row.id === draftId) &&
    !data<any[]>(statusDraft).some((row) => row.id === approvedId),
  "status filter"
);

const keyword = app.call("deal.list", { keyword: "翠湖" }, agent);
assert(
  keyword.ok &&
    data<any[]>(keyword).some((row) => row.id === draftId) &&
    !data<any[]>(keyword).some((row) => row.id === approvedId),
  "keyword filter by house title"
);

const allCsv = app.call("report.dealsListCsv", {}, agent);
assert(allCsv.ok && data<any>(allCsv).content.startsWith("\uFEFF"), "list export utf8 bom");
assert(data<any>(allCsv).filename.includes("成交列表"), "list export filename");
assert(
  data<any>(allCsv).content.includes(draftId) &&
    data<any>(allCsv).content.includes(approvedId) &&
    data<any>(allCsv).content.includes("成交导出翠湖A") &&
    data<any>(allCsv).content.includes("草稿备注"),
  "unfiltered list export content"
);

const draftCsv = app.call("report.dealsListCsv", { status: "draft" }, agent);
assert(
  draftCsv.ok &&
    data<any>(draftCsv).content.includes(draftId) &&
    !data<any>(draftCsv).content.includes(approvedId),
  "status filtered list export"
);

const keywordCsv = app.call("report.dealsListCsv", { keyword: "客乙" }, agent);
assert(
  keywordCsv.ok &&
    data<any>(keywordCsv).content.includes(approvedId) &&
    !data<any>(keywordCsv).content.includes(draftId),
  "keyword filtered list export"
);

const otherCsv = app.call("report.dealsListCsv", {}, otherStore);
assert(
  otherCsv.ok && !data<any>(otherCsv).content.includes(draftId),
  "list export store isolation"
);

const financeCsv = app.call("report.dealsListCsv", { status: "approved" }, finance);
assert(
  financeCsv.ok && data<any>(financeCsv).content.includes(approvedId),
  "finance can export deal list"
);

const monthCsv = app.call(
  "report.dealsCsv",
  { month: new Date().toISOString().slice(0, 7) },
  manager
);
assert(
  monthCsv.ok &&
    data<any>(monthCsv).filename.includes("成交报表") &&
    data<any>(monthCsv).content.includes(approvedId) &&
    !data<any>(monthCsv).content.includes(draftId),
  "monthly approved report export unchanged"
);

const audit = app.call("audit.list", { action: "deal.list.export", limit: 20 }, admin);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "deal.list.export"),
  "deal list export writes audit"
);

console.log(`Deals page export smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
