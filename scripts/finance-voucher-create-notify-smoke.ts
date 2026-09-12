import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "finance-voucher-create-notify-smoke.db")).dbPath
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
const createMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "财务凭证已创建"
  );

const admin = login("admin");
const finance = login("finance");
const manager = login("manager");
const storeId = data<any>(app.call("auth.me", {}, finance)).store_id;

assert(
  !app.call(
    "finance.vouchers.create",
    {
      store_id: storeId,
      voucher_date: "2026-09-01",
      summary: "无权限",
      lines: [
        { account_name: "银行存款", direction: "debit", amount: 100 },
        { account_name: "收入", direction: "credit", amount: 100 },
      ],
    },
    manager
  ).ok,
  "manager cannot create voucher"
);

const beforeFinance = createMsgs(finance).length;
const beforeAdmin = createMsgs(admin).length;
const created = app.call(
  "finance.vouchers.create",
  {
    store_id: storeId,
    voucher_date: "2026-09-01",
    summary: "创建通知凭证",
    lines: [
      { account_name: "银行存款", direction: "debit", amount: 1200 },
      { account_name: "主营业务收入", direction: "credit", amount: 1200 },
    ],
  },
  admin
);
assert(created.ok, "admin creates voucher");
const voucher = data<any>(created);
assert(voucher.status === "draft", "status draft");
assert(createMsgs(finance).length === beforeFinance + 1, "finance receives create message");
assert(createMsgs(admin).length === beforeAdmin, "admin actor does not self-notify");
assert(
  createMsgs(finance).some(
    (m) =>
      m.ref_id === voucher.id &&
      String(m.body).includes(voucher.voucher_no) &&
      String(m.body).includes("创建通知凭证")
  ),
  "create message body"
);

const beforeAdmin2 = createMsgs(admin).length;
const beforeFinance2 = createMsgs(finance).length;
assert(
  app.call(
    "finance.vouchers.create",
    {
      store_id: storeId,
      voucher_date: "2026-09-02",
      summary: "财务创建凭证",
      lines: [
        { account_name: "库存现金", direction: "debit", amount: 300 },
        { account_name: "其他收入", direction: "credit", amount: 300 },
      ],
    },
    finance
  ).ok,
  "finance creates voucher"
);
assert(createMsgs(admin).length === beforeAdmin2 + 1, "admin receives when finance creates");
assert(createMsgs(finance).length === beforeFinance2, "finance actor does not self-notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, finance).ok,
  "mute other"
);
const beforeMute = createMsgs(finance).length;
assert(
  app.call(
    "finance.vouchers.create",
    {
      store_id: storeId,
      voucher_date: "2026-09-03",
      summary: "静音创建凭证",
      lines: [
        { account_name: "银行存款", direction: "debit", amount: 500 },
        { account_name: "收入", direction: "credit", amount: 500 },
      ],
    },
    admin
  ).ok,
  "create while muted"
);
assert(createMsgs(finance).length === beforeMute, "muted other suppresses create message");

console.log(
  `Finance voucher create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
