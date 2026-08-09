import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "earnest-page-export-smoke.db")).dbPath);
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
const finance = login("finance");
const agent = login("agent_a");
const otherStore = login("agent_c");

const houseA = app.call(
  "house.create",
  {
    title: "意向金导出房A",
    deal_type: "sale",
    community: "意向苑",
    price: 180,
    owner_name: "业主A",
    owner_phone: "13780001001",
    status: "available",
  },
  agent
);
assert(houseA.ok, "create house A");
const houseB = app.call(
  "house.create",
  {
    title: "意向金导出房B",
    deal_type: "rent",
    community: "意向苑",
    price: 60,
    owner_name: "业主B",
    owner_phone: "13780001002",
    status: "available",
  },
  agent
);
assert(houseB.ok, "create house B");

const customerA = app.call(
  "customer.create",
  { name: "张三意向", phone: "13780002001", intent: "buy" },
  agent
);
assert(customerA.ok, "create customer A");
const customerB = app.call(
  "customer.create",
  { name: "李四转账", phone: "13780002002", intent: "rent" },
  agent
);
assert(customerB.ok, "create customer B");

const cash = app.call(
  "earnest.create",
  {
    house_id: data<any>(houseA).id,
    customer_id: data<any>(customerA).id,
    amount: 10000,
    method: "cash",
    remark: "现金意向备注",
  },
  agent
);
assert(cash.ok, "create cash earnest");
const cashId = data<any>(cash).id;

const transfer = app.call(
  "earnest.create",
  {
    house_id: data<any>(houseB).id,
    customer_id: data<any>(customerB).id,
    amount: 20000,
    method: "bank",
    remark: "转账意向",
  },
  agent
);
assert(transfer.ok, "create transfer earnest via bank alias");
const transferId = data<any>(transfer).id;

assert(app.call("earnest.refund", { id: transferId, reason: "客户放弃" }, finance).ok, "refund transfer earnest");

const all = app.call("earnest.list", {}, finance);
assert(all.ok && data<any[]>(all).length >= 2, "list all earnest");

const byStatus = app.call("earnest.list", { status: "held" }, finance);
assert(
  byStatus.ok &&
    data<any[]>(byStatus).every((row) => row.status === "held") &&
    data<any[]>(byStatus).some((row) => row.id === cashId) &&
    !data<any[]>(byStatus).some((row) => row.id === transferId),
  "status=held filter"
);

const byRefunded = app.call("earnest.list", { status: "refunded" }, finance);
assert(
  byRefunded.ok && data<any[]>(byRefunded).some((row) => row.id === transferId),
  "status=refunded filter"
);

const byMethod = app.call("earnest.list", { method: "transfer" }, finance);
assert(
  byMethod.ok &&
    data<any[]>(byMethod).every((row) => row.method === "transfer") &&
    data<any[]>(byMethod).some((row) => row.id === transferId) &&
    !data<any[]>(byMethod).some((row) => row.id === cashId),
  "method=transfer filter"
);

const byCash = app.call("earnest.list", { method: "cash" }, finance);
assert(
  byCash.ok && data<any[]>(byCash).some((row) => row.id === cashId && row.method_label === "现金"),
  "method=cash with label"
);

const byCustomer = app.call("earnest.list", { keyword: "张三" }, finance);
assert(
  byCustomer.ok &&
    data<any[]>(byCustomer).some((row) => row.id === cashId) &&
    !data<any[]>(byCustomer).some((row) => row.id === transferId),
  "keyword customer"
);

const byHouse = app.call("earnest.list", { keyword: "导出房B" }, finance);
assert(
  byHouse.ok && data<any[]>(byHouse).some((row) => row.id === transferId),
  "keyword house title"
);

const byRemark = app.call("earnest.list", { keyword: "现金意向备注" }, finance);
assert(
  byRemark.ok && data<any[]>(byRemark).some((row) => row.id === cashId),
  "keyword remark"
);

const byRefundReason = app.call("earnest.list", { keyword: "客户放弃" }, finance);
assert(
  byRefundReason.ok && data<any[]>(byRefundReason).some((row) => row.id === transferId),
  "keyword refund reason"
);

const csvAll = app.call("earnest.export", {}, finance);
assert(csvAll.ok && data<any>(csvAll).content.startsWith("\uFEFF"), "export utf8 bom");
assert(String(data<any>(csvAll).filename).includes("意向金列表"), "export filename");
assert(data<any>(csvAll).rows >= 2, "export row count");
assert(
  data<any>(csvAll).content.includes("意向金编号") &&
    data<any>(csvAll).content.includes(cashId) &&
    data<any>(csvAll).content.includes(transferId) &&
    data<any>(csvAll).content.includes("张三意向") &&
    data<any>(csvAll).content.includes("李四转账") &&
    data<any>(csvAll).content.includes("现金") &&
    data<any>(csvAll).content.includes("转账") &&
    data<any>(csvAll).content.includes("在管") &&
    data<any>(csvAll).content.includes("已退款"),
  "unfiltered export content"
);

const csvHeld = app.call("earnest.export", { status: "held" }, finance);
assert(
  csvHeld.ok &&
    data<any>(csvHeld).content.includes(cashId) &&
    !data<any>(csvHeld).content.includes(transferId),
  "status filtered export"
);

const csvMethod = app.call("earnest.export", { method: "cash" }, finance);
assert(
  csvMethod.ok &&
    data<any>(csvMethod).content.includes(cashId) &&
    !data<any>(csvMethod).content.includes(transferId),
  "method filtered export"
);

const csvKw = app.call("earnest.export", { keyword: "导出房B" }, finance);
assert(
  csvKw.ok &&
    data<any>(csvKw).rows === 1 &&
    data<any>(csvKw).content.includes(transferId),
  "keyword filtered export"
);

const agentCsv = app.call("earnest.export", {}, agent);
assert(
  agentCsv.ok && data<any>(agentCsv).content.includes(cashId),
  "agent can export visible earnest"
);

const otherCsv = app.call("earnest.export", {}, otherStore);
assert(
  otherCsv.ok &&
    !data<any>(otherCsv).content.includes(cashId) &&
    !data<any>(otherCsv).content.includes(transferId),
  "export preserves store isolation"
);

const audit = app.call("audit.list", { action: "earnest.export", limit: 20 }, admin);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "earnest.export"),
  "earnest export writes audit"
);

console.log(`Earnest page export smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
