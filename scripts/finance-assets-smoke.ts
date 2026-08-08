import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "finance-assets-smoke.db")).dbPath);
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
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const storeId = data<any>(app.call("auth.me", {}, manager)).store_id;

check(
  !app.call(
    "finance.assets.save",
    {
      code: "A-001",
      name: "办公桌",
      category: "furniture",
      purchase_date: "2026-01-01",
      original_value: 1200,
      store_id: storeId,
    },
    agent
  ).ok,
  "agent cannot create assets"
);
check(
  !app.call(
    "finance.assets.save",
    {
      code: "A-001",
      name: "办公桌",
      category: "furniture",
      purchase_date: "2026-01-01",
      original_value: 0,
      store_id: storeId,
    },
    finance
  ).ok,
  "asset rejects zero original value"
);
const asset = app.call(
  "finance.assets.save",
  {
    code: "A-001",
    name: "门店办公桌",
    category: "furniture",
    purchase_date: "2026-01-01",
    original_value: 1200,
    residual_value: 100,
    quantity: 2,
    unit: "张",
    custodian_user_id: agentId,
    location: "前台",
    store_id: storeId,
  },
  finance
);
check(asset.ok, "finance creates asset");
const assetId = data<any>(asset).id;
check(
  !app.call(
    "finance.assets.save",
    {
      code: "A-001",
      name: "重复编码",
      category: "furniture",
      purchase_date: "2026-01-02",
      original_value: 800,
      store_id: storeId,
    },
    finance
  ).ok,
  "duplicate asset code blocked"
);
const managerAssets = app.call("finance.assets.list", {}, manager);
check(
  managerAssets.ok && data<any[]>(managerAssets).some((row) => row.id === assetId),
  "manager lists store assets"
);
check(
  app.call(
    "finance.assets.save",
    {
      id: assetId,
      code: "A-001",
      name: "门店办公桌升级",
      category: "furniture",
      purchase_date: "2026-01-01",
      original_value: 1500,
      residual_value: 100,
      quantity: 2,
      custodian_user_id: agentId,
      location: "会议室",
      status: "idle",
      store_id: storeId,
    },
    finance
  ).ok,
  "finance updates asset"
);
check(
  app.call(
    "finance.assets.dispose",
    { id: assetId, reason: "损坏报废", dispose_amount: 50 },
    finance
  ).ok,
  "finance disposes asset"
);
check(
  !app.call(
    "finance.assets.dispose",
    { id: assetId, reason: "再次处置", dispose_amount: 0 },
    finance
  ).ok,
  "cannot dispose already disposed asset"
);

check(
  !app.call(
    "finance.vouchers.create",
    {
      store_id: storeId,
      voucher_date: "2026-08-01",
      summary: "不平衡",
      lines: [
        { account_name: "银行存款", direction: "debit", amount: 100 },
        { account_name: "收入", direction: "credit", amount: 80 },
      ],
    },
    finance
  ).ok,
  "voucher rejects unbalanced lines"
);
check(
  !app.call(
    "finance.vouchers.create",
    {
      store_id: storeId,
      voucher_date: "2026-08-01",
      summary: "单行",
      lines: [{ account_name: "银行存款", direction: "debit", amount: 100 }],
    },
    finance
  ).ok,
  "voucher requires at least two lines"
);
const voucher = app.call(
  "finance.vouchers.create",
  {
    store_id: storeId,
    voucher_date: "2026-08-01",
    summary: "佣金收款备查",
    lines: [
      { account_name: "银行存款", direction: "debit", amount: 8000 },
      { account_name: "主营业务收入", direction: "credit", amount: 8000 },
    ],
  },
  finance
);
check(voucher.ok, "finance creates balanced voucher draft");
const voucherId = data<any>(voucher).id;
check(
  String(data<any>(voucher).voucher_no).startsWith("V20260801"),
  "voucher number uses date prefix"
);
const detail = app.call("finance.vouchers.get", { id: voucherId }, manager);
check(
  detail.ok && data<any>(detail).lines.length === 2,
  "manager can read voucher lines"
);
check(
  app.call(
    "finance.vouchers.update",
    {
      id: voucherId,
      store_id: storeId,
      voucher_date: "2026-08-01",
      summary: "佣金收款备查调整",
      lines: [
        { account_name: "银行存款", direction: "debit", amount: 9000 },
        { account_name: "主营业务收入", direction: "credit", amount: 9000 },
      ],
    },
    finance
  ).ok,
  "finance updates draft voucher"
);
check(
  !app.call(
    "finance.vouchers.create",
    {
      store_id: storeId,
      voucher_date: "2026-08-01",
      summary: "经纪人不可建",
      lines: [
        { account_name: "现金", direction: "debit", amount: 1 },
        { account_name: "收入", direction: "credit", amount: 1 },
      ],
    },
    agent
  ).ok,
  "agent cannot create vouchers"
);
check(
  app.call("finance.vouchers.post", { id: voucherId }, finance).ok,
  "finance posts voucher"
);
check(
  !app.call(
    "finance.vouchers.update",
    {
      id: voucherId,
      voucher_date: "2026-08-01",
      summary: "已过账不可改",
      lines: [
        { account_name: "银行存款", direction: "debit", amount: 1 },
        { account_name: "收入", direction: "credit", amount: 1 },
      ],
    },
    finance
  ).ok,
  "posted voucher cannot update"
);
const second = app.call(
  "finance.vouchers.create",
  {
    store_id: storeId,
    voucher_date: "2026-08-01",
    summary: "第二张草稿",
    lines: [
      { account_name: "库存现金", direction: "debit", amount: 100 },
      { account_name: "其他收入", direction: "credit", amount: 100 },
    ],
  },
  admin
);
check(second.ok, "admin creates second voucher");
check(
  data<any>(second).voucher_no !== data<any>(voucher).voucher_no,
  "voucher numbers increment"
);
check(
  app.call(
    "finance.vouchers.void",
    { id: data<any>(second).id, reason: "录错作废" },
    finance
  ).ok,
  "finance voids draft voucher"
);
check(
  app.call(
    "finance.vouchers.void",
    { id: voucherId, reason: "过账后冲销作废" },
    admin
  ).ok,
  "admin voids posted voucher"
);
const listed = app.call("finance.vouchers.list", { status: "voided" }, finance);
check(
  listed.ok && data<any[]>(listed).length >= 2,
  "list voided vouchers"
);
check(
  !app.call("finance.assets.list", {}, agent).ok,
  "agent cannot list assets"
);
check(
  !app.call(
    "suite.create",
    { module: "finance", record_type: "asset", title: "旧通用资产" },
    finance
  ).ok,
  "generic suite asset removed"
);
check(
  !app.call(
    "suite.create",
    { module: "finance", record_type: "voucher", title: "旧通用凭证" },
    finance
  ).ok,
  "generic suite voucher removed"
);

console.log(`Finance assets smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
