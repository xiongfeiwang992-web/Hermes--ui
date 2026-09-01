import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "cashbook-create-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "收支流水已登记"
  );

const admin = login("admin");
const finance = login("finance");
const manager = login("manager");
const options = app.call("cashbook.options", {}, admin);
assert(options.ok, "cashbook options");
const storeA = data<any>(options).stores.find((s: any) => s.name === "一号店").id;

assert(
  !app.call(
    "cashbook.create",
    {
      direction: "income",
      category: "commission",
      amount: 100,
      occurred_at: new Date().toISOString(),
      payment_method: "cash",
      store_id: storeA,
    },
    manager
  ).ok,
  "manager cannot create cashbook"
);

const beforeFinance = createMsgs(finance).length;
const beforeAdmin = createMsgs(admin).length;
const created = app.call(
  "cashbook.create",
  {
    direction: "income",
    category: "commission",
    amount: 3500,
    occurred_at: new Date().toISOString(),
    payment_method: "bank",
    counterparty: "客户甲",
    store_id: storeA,
    note: "佣金到账",
  },
  admin
);
assert(created.ok, "admin creates cashbook");
const entryId = data<any>(created).id;
assert(createMsgs(finance).length === beforeFinance + 1, "finance receives create message");
assert(createMsgs(admin).length === beforeAdmin, "admin actor does not self-notify");
assert(
  createMsgs(finance).some(
    (m) =>
      m.ref_id === entryId &&
      String(m.body).includes("收入") &&
      String(m.body).includes("3500.00") &&
      String(m.body).includes("客户甲") &&
      String(m.body).includes("commission")
  ),
  "create message body"
);

const beforeAdmin2 = createMsgs(admin).length;
const beforeFinance2 = createMsgs(finance).length;
assert(
  app.call(
    "cashbook.create",
    {
      direction: "expense",
      category: "office",
      amount: 200,
      occurred_at: new Date().toISOString(),
      payment_method: "cash",
      store_id: storeA,
    },
    finance
  ).ok,
  "finance creates expense entry"
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
    "cashbook.create",
    {
      direction: "income",
      category: "deposit",
      amount: 1000,
      occurred_at: new Date().toISOString(),
      payment_method: "wechat",
      store_id: storeA,
    },
    admin
  ).ok,
  "create while muted"
);
assert(createMsgs(finance).length === beforeMute, "muted other suppresses create message");

console.log(`Cashbook create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
