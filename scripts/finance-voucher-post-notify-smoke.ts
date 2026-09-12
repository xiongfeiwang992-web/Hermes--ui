import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "finance-voucher-post-notify-smoke.db")).dbPath
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
const postMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "财务凭证已过账"
  );

const admin = login("admin");
const finance = login("finance");
const storeId = data<any>(app.call("auth.me", {}, finance)).store_id;

function createVoucher(token: string, summary: string, amount: number) {
  const created = app.call(
    "finance.vouchers.create",
    {
      store_id: storeId,
      voucher_date: "2026-09-01",
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

assert(
  !app.call("finance.vouchers.post", { id: "missing" }, admin).ok,
  "cannot post missing voucher"
);

const draft = createVoucher(finance, "过账通知凭证", 1500);
const beforeFinance = postMsgs(finance).length;
const beforeAdmin = postMsgs(admin).length;
const posted = app.call("finance.vouchers.post", { id: draft.id }, admin);
assert(posted.ok, "admin posts finance draft");
assert(data<any>(posted).status === "posted", "status posted");

const afterFinance = postMsgs(finance);
assert(afterFinance.length === beforeFinance + 1, "creator receives post message");
assert(afterFinance[0].ref_id === draft.id, "message refs voucher");
assert(String(afterFinance[0].body).includes(draft.voucher_no), "body has voucher no");
assert(String(afterFinance[0].body).includes("过账通知凭证"), "body has summary");
assert(postMsgs(admin).length === beforeAdmin, "poster does not self-notify");
assert(
  !app.call("finance.vouchers.post", { id: draft.id }, admin).ok,
  "cannot post twice"
);

const self = createVoucher(finance, "自过账凭证", 800);
const beforeSelf = postMsgs(finance).length;
assert(
  app.call("finance.vouchers.post", { id: self.id }, finance).ok,
  "finance posts own voucher"
);
assert(postMsgs(finance).length === beforeSelf, "self-post skips notify");

const muted = createVoucher(finance, "静音过账凭证", 400);
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, finance).ok,
  "mute other channel"
);
const beforeMute = postMsgs(finance).length;
assert(
  app.call("finance.vouchers.post", { id: muted.id }, admin).ok,
  "post while creator muted"
);
assert(postMsgs(finance).length === beforeMute, "muted other suppresses post message");

console.log(
  `Finance voucher post notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
