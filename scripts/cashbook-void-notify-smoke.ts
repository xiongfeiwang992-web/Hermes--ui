import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "cashbook-void-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "收支流水已作废"
  );

const admin = login("admin");
const finance = login("finance");
const storeId = data<any>(app.call("auth.me", {}, finance)).store_id;

function createEntry(
  token: string,
  direction: "income" | "expense",
  amount: number,
  counterparty?: string
) {
  const created = app.call(
    "cashbook.create",
    {
      store_id: storeId,
      direction,
      category: direction === "income" ? "commission" : "office",
      amount,
      occurred_at: "2026-08-09T10:00:00.000Z",
      payment_method: "bank",
      counterparty: counterparty || null,
      note: "作废通知测试",
    },
    token
  );
  assert(created.ok, `create ${direction} ${amount}`);
  return data<any>(created).id;
}

const entryId = createEntry(finance, "income", 1280.5, "购房客户甲");
assert(
  !app.call("cashbook.void", { id: entryId, reason: "" }, admin).ok,
  "void requires reason"
);

const beforeFinance = voidMsgs(finance).length;
const beforeAdmin = voidMsgs(admin).length;
const voided = app.call(
  "cashbook.void",
  { id: entryId, reason: "到账冲正作废" },
  admin
);
assert(voided.ok, "admin voids finance entry");
assert(data<any>(voided).status === "voided", "status voided");

const afterFinance = voidMsgs(finance);
assert(afterFinance.length === beforeFinance + 1, "creator receives void message");
assert(afterFinance[0].ref_id === entryId, "message refs entry");
assert(String(afterFinance[0].body).includes("收入"), "body has direction");
assert(String(afterFinance[0].body).includes("1280.50"), "body has amount");
assert(String(afterFinance[0].body).includes("购房客户甲"), "body has counterparty");
assert(String(afterFinance[0].body).includes("到账冲正作废"), "body has reason");
assert(voidMsgs(admin).length === beforeAdmin, "voider does not self-notify");
assert(
  !app.call("cashbook.void", { id: entryId, reason: "再次作废" }, admin).ok,
  "cannot void twice"
);

const selfId = createEntry(finance, "expense", 88, "办公用品");
const beforeSelf = voidMsgs(finance).length;
assert(
  app.call("cashbook.void", { id: selfId, reason: "财务自行作废" }, finance).ok,
  "finance voids own entry"
);
assert(voidMsgs(finance).length === beforeSelf, "self-void does not notify creator");

const mutedId = createEntry(finance, "income", 500, "静音客户");
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, finance).ok,
  "mute other channel"
);
const beforeMute = voidMsgs(finance).length;
assert(
  app.call("cashbook.void", { id: mutedId, reason: "静音场景作废" }, admin).ok,
  "void while creator muted"
);
assert(voidMsgs(finance).length === beforeMute, "muted other suppresses void message");

console.log(`Cashbook void notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
