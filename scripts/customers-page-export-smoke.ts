import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "customers-page-export-smoke.db")).dbPath);
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
const peer = login("agent_b");
const otherStore = login("agent_c");

const buy = app.call(
  "customer.create",
  {
    name: "导出求购客",
    phone: "13880001001",
    intent: "buy",
    level: "A",
    source: "门店到访",
    budget_min: 100,
    budget_max: 200,
    need: "三房翠湖",
  },
  agent
);
assert(buy.ok, "create buy customer");
const buyId = data<any>(buy).id;

const rent = app.call(
  "customer.create",
  {
    name: "导出租客",
    phone: "13880001002",
    intent: "rent",
    level: "B",
    source: "转介",
    need: "一房近地铁",
  },
  agent
);
assert(rent.ok, "create rent customer");
const rentId = data<any>(rent).id;

const publicCus = app.call(
  "customer.create",
  {
    name: "导出公客",
    phone: "13880001003",
    intent: "buy",
    source: "官网",
  },
  agent
);
assert(publicCus.ok, "create public customer");
const publicId = data<any>(publicCus).id;
assert(
  app.call("customer.toPublic", { id: publicId, reason: "导出测试转公" }, agent).ok,
  "to public"
);

const allCsv = app.call("report.customersCsv", {}, agent);
assert(allCsv.ok && data<any>(allCsv).content.startsWith("\uFEFF"), "agent export utf8 bom");
assert(data<any>(allCsv).filename.includes("客源列表"), "export filename");
assert(
  data<any>(allCsv).content.includes(buyId) && data<any>(allCsv).content.includes(rentId),
  "unfiltered export includes buy and rent"
);
assert(data<any>(allCsv).content.includes("门店到访"), "export uses source label");

const buyOnly = app.call("report.customersCsv", { intent: "buy" }, agent);
assert(
  buyOnly.ok &&
    data<any>(buyOnly).content.includes(buyId) &&
    !data<any>(buyOnly).content.includes(rentId),
  "intent filter export"
);

const privateOnly = app.call("report.customersCsv", { visibility: "private" }, agent);
assert(
  privateOnly.ok &&
    data<any>(privateOnly).content.includes(buyId) &&
    !data<any>(privateOnly).content.includes(publicId),
  "visibility filter export"
);

const sourceOnly = app.call("report.customersCsv", { source: "转介" }, agent);
assert(
  sourceOnly.ok &&
    data<any>(sourceOnly).content.includes(rentId) &&
    !data<any>(sourceOnly).content.includes(buyId),
  "source filter export"
);

const keywordCsv = app.call("report.customersCsv", { keyword: "翠湖" }, agent);
assert(
  keywordCsv.ok &&
    data<any>(keywordCsv).content.includes(buyId) &&
    !data<any>(keywordCsv).content.includes(rentId),
  "keyword filter export"
);

const peerCsv = app.call("report.customersCsv", { keyword: "导出求购" }, peer);
assert(
  peerCsv.ok && !data<any>(peerCsv).content.includes("13880001001"),
  "export masks phone for peer"
);

const otherCsv = app.call("report.customersCsv", {}, otherStore);
assert(
  otherCsv.ok && !data<any>(otherCsv).content.includes(buyId),
  "export preserves store isolation"
);

assert(!app.call("report.customersCsv", {}, finance).ok, "finance cannot export customers");

const managerCsv = app.call(
  "report.customersCsv",
  { intent: "buy", visibility: "public" },
  manager
);
assert(
  managerCsv.ok &&
    data<any>(managerCsv).content.includes(publicId) &&
    !data<any>(managerCsv).content.includes(rentId),
  "manager filtered export"
);

const audit = app.call("audit.list", { action: "customer.export", limit: 20 }, admin);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "customer.export"),
  "customer export writes audit"
);

console.log(`Customers page export smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
