import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "finance-asset-create-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "固定资产已登记"
  );

const admin = login("admin");
const finance = login("finance");
const agent = login("agent_a");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const financeId = data<any>(app.call("auth.me", {}, finance)).id;
const storeId = data<any>(app.call("auth.me", {}, finance)).store_id;

assert(
  !app.call(
    "finance.assets.save",
    {
      code: "AST-BAD",
      name: "无效",
      category: "electronics",
      purchase_date: "2026-02-01",
      original_value: 0,
      residual_value: 0,
      store_id: storeId,
    },
    finance
  ).ok,
  "original value validated"
);

const beforeAgent = createMsgs(agent).length;
const beforeFinance = createMsgs(finance).length;
const created = app.call(
  "finance.assets.save",
  {
    code: "AST-CREATE-1",
    name: "登记通知电脑",
    category: "electronics",
    purchase_date: "2026-02-01",
    original_value: 4500,
    residual_value: 200,
    quantity: 1,
    unit: "台",
    custodian_user_id: agentId,
    location: "一号店",
    store_id: storeId,
  },
  finance
);
assert(created.ok, "finance creates asset with custodian");
const assetId = data<any>(created).id;
assert(createMsgs(agent).length === beforeAgent + 1, "custodian receives create message");
assert(createMsgs(finance).length === beforeFinance, "creator does not self-notify");
assert(
  createMsgs(agent).some(
    (m) =>
      m.ref_id === assetId &&
      String(m.body).includes("AST-CREATE-1") &&
      String(m.body).includes("登记通知电脑")
  ),
  "create message body"
);

const beforeSelf = createMsgs(finance).length;
assert(
  app.call(
    "finance.assets.save",
    {
      code: "AST-CREATE-2",
      name: "自管资产",
      category: "furniture",
      purchase_date: "2026-03-01",
      original_value: 800,
      residual_value: 50,
      custodian_user_id: financeId,
      store_id: storeId,
    },
    finance
  ).ok,
  "create self-custodian asset"
);
assert(createMsgs(finance).length === beforeSelf, "self custodian skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const beforeMute = createMsgs(agent).length;
assert(
  app.call(
    "finance.assets.save",
    {
      code: "AST-CREATE-3",
      name: "静音资产",
      category: "equipment",
      purchase_date: "2026-04-01",
      original_value: 1200,
      residual_value: 100,
      custodian_user_id: agentId,
      store_id: storeId,
    },
    admin
  ).ok,
  "create while muted"
);
assert(createMsgs(agent).length === beforeMute, "muted other suppresses create message");

console.log(
  `Finance asset create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
