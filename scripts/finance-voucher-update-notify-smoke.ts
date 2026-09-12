import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "finance-voucher-update-notify-smoke.db")).dbPath
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
const updateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "财务凭证已更新"
  );

const admin = login("admin");
const finance = login("finance");
const manager = login("manager");
const storeId = data<any>(app.call("auth.me", {}, finance)).store_id;

const created = app.call(
  "finance.vouchers.create",
  {
    store_id: storeId,
    voucher_date: "2026-09-01",
    summary: "更新通知凭证原稿",
    lines: [
      { account_name: "银行存款", direction: "debit", amount: 1500 },
      { account_name: "主营业务收入", direction: "credit", amount: 1500 },
    ],
  },
  admin
);
assert(created.ok, "admin creates voucher");
const voucher = data<any>(created);

assert(
  !app.call(
    "finance.vouchers.update",
    {
      id: voucher.id,
      store_id: storeId,
      voucher_date: "2026-09-02",
      summary: "无权限更新",
      lines: [
        { account_name: "银行存款", direction: "debit", amount: 100 },
        { account_name: "收入", direction: "credit", amount: 100 },
      ],
    },
    manager
  ).ok,
  "manager cannot update voucher"
);

const beforeFinance = updateMsgs(finance).length;
const beforeAdmin = updateMsgs(admin).length;
const updated = app.call(
  "finance.vouchers.update",
  {
    id: voucher.id,
    store_id: storeId,
    voucher_date: "2026-09-02",
    summary: "更新通知凭证改稿",
    lines: [
      { account_name: "银行存款", direction: "debit", amount: 1600 },
      { account_name: "主营业务收入", direction: "credit", amount: 1600 },
    ],
  },
  admin
);
assert(updated.ok, "admin updates voucher");
assert(updateMsgs(finance).length === beforeFinance + 1, "finance receives update message");
assert(updateMsgs(admin).length === beforeAdmin, "admin actor does not self-notify");
assert(
  updateMsgs(finance).some(
    (m) =>
      m.ref_id === voucher.id &&
      m.ref_type === "finance_voucher" &&
      String(m.body).includes(voucher.voucher_no) &&
      String(m.body).includes("更新通知凭证改稿")
  ),
  "update message body"
);

const beforeAdmin2 = updateMsgs(admin).length;
const beforeFinance2 = updateMsgs(finance).length;
assert(
  app.call(
    "finance.vouchers.update",
    {
      id: voucher.id,
      store_id: storeId,
      voucher_date: "2026-09-03",
      summary: "财务更新凭证",
      lines: [
        { account_name: "库存现金", direction: "debit", amount: 400 },
        { account_name: "其他收入", direction: "credit", amount: 400 },
      ],
    },
    finance
  ).ok,
  "finance updates voucher"
);
assert(updateMsgs(admin).length === beforeAdmin2 + 1, "admin receives when finance updates");
assert(updateMsgs(finance).length === beforeFinance2, "finance actor does not self-notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, finance).ok,
  "mute other"
);
const beforeMute = updateMsgs(finance).length;
assert(
  app.call(
    "finance.vouchers.update",
    {
      id: voucher.id,
      store_id: storeId,
      voucher_date: "2026-09-04",
      summary: "静音更新凭证",
      lines: [
        { account_name: "银行存款", direction: "debit", amount: 500 },
        { account_name: "收入", direction: "credit", amount: 500 },
      ],
    },
    admin
  ).ok,
  "update while muted"
);
assert(updateMsgs(finance).length === beforeMute, "muted other suppresses update message");

console.log(
  `Finance voucher update notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
