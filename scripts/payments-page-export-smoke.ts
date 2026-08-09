import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "payments-page-export-smoke.db")).dbPath);
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

const house = app.call(
  "house.create",
  {
    title: "收款导出房",
    deal_type: "sale",
    community: "收款苑",
    price: 200,
    owner_name: "业主",
    owner_phone: "13680001001",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const customer = app.call(
  "customer.create",
  { name: "收款导出客", phone: "13680002001", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 200,
    commission_owner: 10000,
    commission_customer: 8000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;
assert(app.call("deal.submit", { id: dealId }, agent).ok, "submit deal");
assert(app.call("deal.approve", { id: dealId }, manager).ok, "approve deal");

const pendingPay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 5000, method: "transfer", payer_side: "customer" },
  finance
);
assert(pendingPay.ok, "create pending payment");
const pendingId = data<any>(pendingPay).id;

const wechatPay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 3000, method: "wechat", payer_side: "owner" },
  finance
);
assert(wechatPay.ok, "create wechat payment");
const wechatId = data<any>(wechatPay).id;
assert(app.call("payment.confirm", { id: wechatId }, finance).ok, "confirm wechat");

const transferPay = app.call(
  "payment.create",
  { deal_id: dealId, amount: 2000, method: "transfer", payer_side: "customer" },
  finance
);
assert(transferPay.ok, "create transfer payment");
const transferId = data<any>(transferPay).id;
assert(app.call("payment.confirm", { id: transferId }, finance).ok, "confirm transfer");

const refund = app.call(
  "payment.refund",
  { deal_id: dealId, amount: 1000, method: "transfer", reason: "部分退款测试" },
  finance
);
assert(refund.ok, "create refund");
const refundId = data<any>(refund).id;

const statusPending = app.call("payment.list", { status: "pending" }, finance);
assert(
  statusPending.ok &&
    data<any[]>(statusPending).some((row) => row.id === pendingId) &&
    !data<any[]>(statusPending).some((row) => row.id === wechatId),
  "status filter"
);

const directionOut = app.call("payment.list", { direction: "out" }, finance);
assert(
  directionOut.ok &&
    data<any[]>(directionOut).some((row) => row.id === refundId) &&
    !data<any[]>(directionOut).some((row) => row.id === wechatId),
  "direction filter"
);

const methodWechat = app.call("payment.list", { method: "wechat" }, finance);
assert(
  methodWechat.ok &&
    data<any[]>(methodWechat).some((row) => row.id === wechatId) &&
    !data<any[]>(methodWechat).some((row) => row.id === transferId),
  "method filter"
);

const keyword = app.call("payment.list", { keyword: "部分退款" }, finance);
assert(
  keyword.ok &&
    data<any[]>(keyword).some((row) => row.id === refundId) &&
    !data<any[]>(keyword).some((row) => row.id === pendingId),
  "keyword filter"
);

const allCsv = app.call("report.paymentsCsv", {}, finance);
assert(allCsv.ok && data<any>(allCsv).content.startsWith("\uFEFF"), "export utf8 bom");
assert(data<any>(allCsv).filename.includes("收款列表"), "export filename");
assert(
  data<any>(allCsv).content.includes(pendingId) &&
    data<any>(allCsv).content.includes(refundId) &&
    data<any>(allCsv).content.includes("微信") &&
    data<any>(allCsv).content.includes("退款"),
  "unfiltered export content"
);

const confirmedCsv = app.call("report.paymentsCsv", { status: "confirmed" }, finance);
assert(
  confirmedCsv.ok &&
    data<any>(confirmedCsv).content.includes(wechatId) &&
    data<any>(confirmedCsv).content.includes(refundId) &&
    !data<any>(confirmedCsv).content.includes(pendingId),
  "status filtered export"
);

const outCsv = app.call("report.paymentsCsv", { direction: "out" }, finance);
assert(
  outCsv.ok &&
    data<any>(outCsv).content.includes(refundId) &&
    !data<any>(outCsv).content.includes(wechatId),
  "direction filtered export"
);

const agentCsv = app.call("report.paymentsCsv", {}, agent);
assert(
  agentCsv.ok && data<any>(agentCsv).content.includes(wechatId),
  "agent can export own deal payments"
);

const otherCsv = app.call("report.paymentsCsv", {}, otherStore);
assert(
  otherCsv.ok && !data<any>(otherCsv).content.includes(dealId),
  "export preserves store isolation"
);

const audit = app.call("audit.list", { action: "payment.export", limit: 20 }, admin);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "payment.export"),
  "payment export writes audit"
);
const exportDetails = (data<any[]>(audit) || [])
  .filter((row) => row.action === "payment.export")
  .map((row) => JSON.parse(row.detail || "{}"));
assert(
  exportDetails.some(
    (detail) =>
      detail.confirmed_in === 5000 &&
      detail.confirmed_out === 1000 &&
      detail.pending_in === 5000 &&
      detail.net_confirmed === 4000
  ),
  "export audit carries list totals"
);

console.log(`Payments page export smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
