import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "finance-voucher-void-notify-smoke.db")).dbPath
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
const voidMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "财务凭证已作废"
  );

const admin = login("admin");
const finance = login("finance");
const storeId = data<any>(app.call("auth.me", {}, finance)).store_id;

function createVoucher(token: string, summary: string, amount: number) {
  const created = app.call(
    "finance.vouchers.create",
    {
      store_id: storeId,
      voucher_date: "2026-08-09",
      summary,
      lines: [
        { account_name: "银行存款", direction: "debit", amount },
        { account_name: "主营业务收入", direction: "credit", amount },
      ],
    },
    token
  );
  assert(created.ok, `create ${summary}`);
  return data<any>(created);
}

const draft = createVoucher(finance, "草稿作废通知凭证", 1200);
const beforeFinance = voidMsgs(finance).length;
const beforeAdmin = voidMsgs(admin).length;
assert(
  !app.call("finance.vouchers.void", { id: draft.id, reason: "短" }, admin).ok,
  "void reason min length"
);
const voidedDraft = app.call(
  "finance.vouchers.void",
  { id: draft.id, reason: "录错作废" },
  admin
);
assert(voidedDraft.ok, "admin voids finance draft");
assert(data<any>(voidedDraft).status === "voided", "draft status voided");
const afterFinance = voidMsgs(finance);
assert(afterFinance.length === beforeFinance + 1, "creator receives void message");
assert(afterFinance[0].ref_id === draft.id, "message refs voucher");
assert(String(afterFinance[0].body).includes(draft.voucher_no), "body has voucher no");
assert(String(afterFinance[0].body).includes("草稿作废通知凭证"), "body has summary");
assert(String(afterFinance[0].body).includes("录错作废"), "body has reason");
assert(voidMsgs(admin).length === beforeAdmin, "voider does not self-notify");
assert(
  !app.call("finance.vouchers.void", { id: draft.id, reason: "再次作废" }, admin).ok,
  "cannot void twice"
);

const postedSame = createVoucher(finance, "过账后同人作废", 800);
assert(app.call("finance.vouchers.post", { id: postedSame.id }, finance).ok, "finance posts own");
const beforeSame = voidMsgs(finance).length;
assert(
  app.call(
    "finance.vouchers.void",
    { id: postedSame.id, reason: "过账后冲销作废" },
    admin
  ).ok,
  "admin voids posted voucher"
);
assert(
  voidMsgs(finance).length === beforeSame + 1,
  "finance receives one message when created and posted by self"
);

const cross = createVoucher(finance, "跨角色过账作废", 500);
assert(app.call("finance.vouchers.post", { id: cross.id }, admin).ok, "admin posts finance draft");
const beforeAdminCross = voidMsgs(admin).length;
const beforeFinanceCross = voidMsgs(finance).length;
assert(
  app.call(
    "finance.vouchers.void",
    { id: cross.id, reason: "财务冲销已过账凭证" },
    finance
  ).ok,
  "finance voids admin-posted voucher"
);
assert(
  voidMsgs(admin).length === beforeAdminCross + 1,
  "posted_by receives when finance voids"
);
assert(
  voidMsgs(finance).length === beforeFinanceCross,
  "finance voider does not self-notify"
);

const muted = createVoucher(finance, "静音作废凭证", 300);
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, finance).ok,
  "mute other channel"
);
const beforeMute = voidMsgs(finance).length;
assert(
  app.call(
    "finance.vouchers.void",
    { id: muted.id, reason: "静音场景作废" },
    admin
  ).ok,
  "void while creator muted"
);
assert(voidMsgs(finance).length === beforeMute, "muted other suppresses void message");

console.log(
  `Finance voucher void notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
