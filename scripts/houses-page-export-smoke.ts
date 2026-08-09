import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "houses-page-export-smoke.db")).dbPath);
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

const sale = app.call(
  "house.create",
  {
    title: "导出售盘翠湖",
    deal_type: "sale",
    property_type: "residential",
    community: "翠湖苑",
    price: 188,
    owner_name: "售业主",
    owner_phone: "13980001001",
    status: "available",
  },
  agent
);
assert(sale.ok, "create sale house");
const saleId = data<any>(sale).id;

const rent = app.call(
  "house.create",
  {
    title: "导出租盘翠湖",
    deal_type: "rent",
    property_type: "shop",
    community: "翠湖苑",
    price: 3500,
    owner_name: "租业主",
    owner_phone: "13980001002",
    status: "available",
  },
  agent
);
assert(rent.ok, "create rent house");
const rentId = data<any>(rent).id;

const draft = app.call(
  "house.create",
  {
    title: "导出草稿盘",
    deal_type: "sale",
    community: "别苑",
    price: 99,
    owner_name: "草稿业主",
    owner_phone: "13980001003",
    status: "draft",
  },
  agent
);
assert(draft.ok, "create draft house");
const draftId = data<any>(draft).id;

const allCsv = app.call("report.housesCsv", {}, agent);
assert(allCsv.ok && data<any>(allCsv).content.startsWith("\uFEFF"), "agent export utf8 bom");
assert(data<any>(allCsv).filename.includes("房源列表"), "export filename");
assert(
  data<any>(allCsv).content.includes(saleId) && data<any>(allCsv).content.includes(rentId),
  "unfiltered export includes sale and rent"
);
assert(data<any>(allCsv).rows >= 3, "unfiltered export row count");

const saleOnly = app.call("report.housesCsv", { deal_type: "sale" }, agent);
assert(
  saleOnly.ok &&
    data<any>(saleOnly).content.includes(saleId) &&
    !data<any>(saleOnly).content.includes(rentId),
  "deal_type filter export"
);

const rentShop = app.call(
  "report.housesCsv",
  { deal_type: "rent", property_type: "shop" },
  agent
);
assert(
  rentShop.ok &&
    data<any>(rentShop).content.includes(rentId) &&
    !data<any>(rentShop).content.includes(saleId),
  "property_type filter export"
);

const draftOnly = app.call("report.housesCsv", { status: "draft" }, agent);
assert(
  draftOnly.ok &&
    data<any>(draftOnly).content.includes(draftId) &&
    !data<any>(draftOnly).content.includes(saleId),
  "status filter export"
);

const keywordCsv = app.call("report.housesCsv", { keyword: "翠湖" }, agent);
assert(
  keywordCsv.ok &&
    data<any>(keywordCsv).content.includes(saleId) &&
    data<any>(keywordCsv).content.includes(rentId) &&
    !data<any>(keywordCsv).content.includes(draftId),
  "keyword filter export"
);

const peerCsv = app.call("report.housesCsv", { keyword: "翠湖" }, peer);
assert(
  peerCsv.ok && !data<any>(peerCsv).content.includes("13980001001"),
  "export masks owner phone for peer"
);

const otherCsv = app.call("report.housesCsv", {}, otherStore);
assert(
  otherCsv.ok && !data<any>(otherCsv).content.includes(saleId),
  "export preserves store isolation"
);

assert(!app.call("report.housesCsv", {}, finance).ok, "finance cannot export houses");

const managerCsv = app.call("report.housesCsv", { deal_type: "sale", status: "available" }, manager);
assert(
  managerCsv.ok &&
    data<any>(managerCsv).content.includes(saleId) &&
    !data<any>(managerCsv).content.includes(draftId),
  "manager filtered export"
);

const audit = app.call(
  "audit.list",
  { action: "house.export", limit: 20 },
  admin
);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "house.export"),
  "house export writes audit"
);

console.log(`Houses page export smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
