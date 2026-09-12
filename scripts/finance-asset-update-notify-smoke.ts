import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "finance-asset-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "固定资产已更新"
  );

const admin = login("admin");
const finance = login("finance");
const agent = login("agent_a");
const manager = login("manager");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;
const financeId = data<any>(app.call("auth.me", {}, finance)).id;
const storeId = data<any>(app.call("auth.me", {}, finance)).store_id;

const created = app.call(
  "finance.assets.save",
  {
    code: "AST-UPD-1",
    name: "更新通知电脑原稿",
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
assert(created.ok, "finance creates asset");
const assetId = data<any>(created).id;

const beforeAgent = updateMsgs(agent).length;
const beforeFinance = updateMsgs(finance).length;
const updated = app.call(
  "finance.assets.save",
  {
    id: assetId,
    code: "AST-UPD-1",
    name: "更新通知电脑改稿",
    category: "electronics",
    purchase_date: "2026-02-01",
    original_value: 4600,
    residual_value: 200,
    quantity: 1,
    unit: "台",
    custodian_user_id: agentId,
    location: "一号店机房",
    store_id: storeId,
  },
  finance
);
assert(updated.ok, "finance updates asset");
assert(updateMsgs(agent).length === beforeAgent + 1, "custodian receives update message");
assert(updateMsgs(finance).length === beforeFinance, "updater does not self-notify");
assert(
  updateMsgs(agent).some(
    (m) =>
      m.ref_id === assetId &&
      m.ref_type === "finance_asset" &&
      String(m.body).includes("AST-UPD-1") &&
      String(m.body).includes("更新通知电脑改稿")
  ),
  "update message body"
);

const beforeAgent2 = updateMsgs(agent).length;
const beforeMgr = updateMsgs(manager).length;
const beforeFin2 = updateMsgs(finance).length;
assert(
  app.call(
    "finance.assets.save",
    {
      id: assetId,
      code: "AST-UPD-1",
      name: "移交店长保管",
      category: "electronics",
      purchase_date: "2026-02-01",
      original_value: 4600,
      residual_value: 200,
      custodian_user_id: managerId,
      store_id: storeId,
    },
    finance
  ).ok,
  "change custodian to manager"
);
assert(updateMsgs(manager).length === beforeMgr + 1, "new custodian notified");
assert(updateMsgs(agent).length === beforeAgent2 + 1, "previous custodian notified");
assert(updateMsgs(finance).length === beforeFin2, "finance actor still skips self");

const beforeSelf = updateMsgs(finance).length;
assert(
  app.call(
    "finance.assets.save",
    {
      id: assetId,
      code: "AST-UPD-1",
      name: "财务自管",
      category: "electronics",
      purchase_date: "2026-02-01",
      original_value: 4600,
      residual_value: 200,
      custodian_user_id: financeId,
      store_id: storeId,
    },
    finance
  ).ok,
  "update to self custodian"
);
assert(updateMsgs(finance).length === beforeSelf, "self custodian skips notify");
assert(updateMsgs(manager).length === beforeMgr + 2, "previous manager custodian notified on handoff");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
// reassign to agent while muted
const beforeMute = updateMsgs(agent).length;
assert(
  app.call(
    "finance.assets.save",
    {
      id: assetId,
      code: "AST-UPD-1",
      name: "静音更新资产",
      category: "electronics",
      purchase_date: "2026-02-01",
      original_value: 4700,
      residual_value: 200,
      custodian_user_id: agentId,
      store_id: storeId,
    },
    admin
  ).ok,
  "update while muted"
);
assert(updateMsgs(agent).length === beforeMute, "muted other suppresses update message");

console.log(
  `Finance asset update notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
