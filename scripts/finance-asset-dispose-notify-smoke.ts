import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "finance-asset-dispose-notify-smoke.db")).dbPath
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
const disposeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "固定资产已处置"
  );

const admin = login("admin");
const finance = login("finance");
const agent = login("agent_a");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const financeId = data<any>(app.call("auth.me", {}, finance)).id;
const storeId = data<any>(app.call("auth.me", {}, finance)).store_id;

let assetSeq = 0;
function createAsset(opts: {
  code: string;
  name: string;
  custodian_user_id?: string | null;
  creatorToken?: string;
}) {
  assetSeq += 1;
  const token = opts.creatorToken || finance;
  const created = app.call(
    "finance.assets.save",
    {
      code: opts.code,
      name: opts.name,
      category: "electronics",
      purchase_date: "2026-02-01",
      original_value: 2000 + assetSeq,
      residual_value: 100,
      quantity: 1,
      unit: "台",
      custodian_user_id: opts.custodian_user_id ?? null,
      location: "库房",
      store_id: storeId,
    },
    token
  );
  assert(created.ok, `create ${opts.code}`);
  return data<any>(created).id;
}

assert(
  !app.call(
    "finance.assets.dispose",
    { id: "missing", reason: "短", dispose_amount: 0 },
    finance
  ).ok,
  "dispose reason min length"
);

const withCustodian = createAsset({
  code: "DISP-001",
  name: "报废投影仪",
  custodian_user_id: agentId,
});
const beforeAgent = disposeMsgs(agent).length;
const beforeFinance = disposeMsgs(finance).length;
const beforeAdmin = disposeMsgs(admin).length;
const disposed = app.call(
  "finance.assets.dispose",
  { id: withCustodian, reason: "损坏无法维修", dispose_amount: 80.5 },
  admin
);
assert(disposed.ok, "admin disposes finance-created asset");
assert(data<any>(disposed).status === "disposed", "status disposed");

const afterAgent = disposeMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "custodian receives dispose message");
assert(afterAgent[0].ref_id === withCustodian, "message refs asset");
assert(String(afterAgent[0].body).includes("DISP-001"), "body has asset code");
assert(String(afterAgent[0].body).includes("报废投影仪"), "body has asset name");
assert(String(afterAgent[0].body).includes("80.50"), "body has dispose amount");
assert(String(afterAgent[0].body).includes("损坏无法维修"), "body has reason");

const afterFinance = disposeMsgs(finance);
assert(afterFinance.length === beforeFinance + 1, "creator receives dispose message");
assert(afterFinance[0].ref_id === withCustodian, "creator message refs asset");
assert(disposeMsgs(admin).length === beforeAdmin, "disposer does not self-notify");

assert(
  !app.call(
    "finance.assets.dispose",
    { id: withCustodian, reason: "再次处置", dispose_amount: 0 },
    admin
  ).ok,
  "cannot dispose twice"
);

const noCustodian = createAsset({
  code: "DISP-002",
  name: "无保管人打印机",
  custodian_user_id: null,
});
const beforeFinance2 = disposeMsgs(finance).length;
const beforeAgent2 = disposeMsgs(agent).length;
assert(
  app.call(
    "finance.assets.dispose",
    { id: noCustodian, reason: "淘汰替换", dispose_amount: 0 },
    admin
  ).ok,
  "admin disposes asset without custodian"
);
assert(
  disposeMsgs(finance).length === beforeFinance2 + 1,
  "creator still notified without custodian"
);
assert(
  disposeMsgs(agent).length === beforeAgent2,
  "non-custodian agent not notified"
);
assert(
  disposeMsgs(finance).some((m) => m.ref_id === noCustodian && !String(m.body).includes("处置金额")),
  "zero dispose amount omits amount text"
);

const selfCreated = createAsset({
  code: "DISP-003",
  name: "财务自处置电脑",
  custodian_user_id: financeId,
  creatorToken: finance,
});
const beforeSelf = disposeMsgs(finance).length;
assert(
  app.call(
    "finance.assets.dispose",
    { id: selfCreated, reason: "本人登记并处置", dispose_amount: 10 },
    finance
  ).ok,
  "finance disposes own custodied asset"
);
assert(
  disposeMsgs(finance).length === beforeSelf,
  "creator-custodian disposer skips self-notify"
);

const mutedAsset = createAsset({
  code: "DISP-004",
  name: "静音处置资产",
  custodian_user_id: agentId,
});
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other channel for custodian"
);
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, finance).ok,
  "mute other channel for creator"
);
const beforeMuteAgent = disposeMsgs(agent).length;
const beforeMuteFinance = disposeMsgs(finance).length;
assert(
  app.call(
    "finance.assets.dispose",
    { id: mutedAsset, reason: "静音场景处置", dispose_amount: 1 },
    admin
  ).ok,
  "dispose while recipients muted"
);
assert(disposeMsgs(agent).length === beforeMuteAgent, "muted other suppresses custodian message");
assert(
  disposeMsgs(finance).length === beforeMuteFinance,
  "muted other suppresses creator message"
);

console.log(
  `Finance asset dispose notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
