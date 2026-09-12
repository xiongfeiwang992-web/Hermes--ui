import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "deal-rename-cancel-notify-smoke.db")).dbPath
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
const cancelMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "deal_rename" && m.title === "成交更名已取消"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

function createApprovedDeal(title: string, phoneSuffix: string) {
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "更名取消小区",
      price: 260,
      owner_name: "原业主更名测",
      owner_phone: `1378${phoneSuffix}`,
      status: "available",
    },
    agent
  );
  assert(house.ok, `create house ${title}`);
  const customer = app.call(
    "customer.create",
    { name: `原客户${phoneSuffix}`, phone: `1388${phoneSuffix}`, intent: "buy" },
    agent
  );
  assert(customer.ok, `create customer ${phoneSuffix}`);
  const deal = app.call(
    "deal.create",
    {
      house_id: data<any>(house).id,
      customer_id: data<any>(customer).id,
      contract_price: 240,
      commission_owner: 7000,
      commission_customer: 7000,
      agent_ids: [agentId],
      split_ratios: { [agentId]: 100 },
    },
    agent
  );
  assert(deal.ok, `create deal ${title}`);
  const dealId = data<any>(deal).id;
  assert(app.call("deal.submit", { id: dealId }, agent).ok, `submit ${title}`);
  assert(app.call("deal.approve", { id: dealId }, manager).ok, `approve ${title}`);
  return dealId;
}

const dealId = createApprovedDeal("更名取消通知房", "0000201");
const rename = app.call(
  "dealExt.renames.create",
  {
    deal_id: dealId,
    target: "customer",
    new_customer_name: "更名取消新客户",
    reason: "网签主体名称更正",
  },
  agent
);
assert(rename.ok, "agent creates rename draft");
const renameId = data<any>(rename).id;

assert(
  !app.call(
    "dealExt.renames.cancel",
    { id: renameId, reason: "暂" },
    manager
  ).ok,
  "cancel reason min length"
);
assert(
  !app.call(
    "dealExt.renames.cancel",
    { id: renameId, reason: "他人不可取消" },
    peer
  ).ok,
  "peer cannot cancel rename"
);

const beforeAgent = cancelMsgs(agent).length;
const beforeManager = cancelMsgs(manager).length;
const cancelled = app.call(
  "dealExt.renames.cancel",
  { id: renameId, reason: "材料暂缺取消" },
  manager
);
assert(cancelled.ok, "manager cancels agent draft rename");
assert(data<any>(cancelled).status === "cancelled", "status cancelled");

const afterAgent = cancelMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "creator receives cancel message");
assert(afterAgent[0].ref_id === renameId, "message refs rename");
assert(String(afterAgent[0].body).includes("网签主体名称更正"), "body has apply reason");
assert(String(afterAgent[0].body).includes("材料暂缺取消"), "body has cancel reason");
assert(cancelMsgs(manager).length === beforeManager, "canceller does not self-notify");
assert(
  !app.call(
    "dealExt.renames.cancel",
    { id: renameId, reason: "再次取消" },
    manager
  ).ok,
  "cannot cancel twice"
);

const dealId2 = createApprovedDeal("自行取消更名房", "0000202");
const selfRename = app.call(
  "dealExt.renames.create",
  {
    deal_id: dealId2,
    target: "owner",
    new_owner_name: "自行取消新业主",
    reason: "业主证件更正草稿",
  },
  agent
);
assert(selfRename.ok, "create self-cancel rename");
const beforeSelf = cancelMsgs(agent).length;
assert(
  app.call(
    "dealExt.renames.cancel",
    { id: data<any>(selfRename).id, reason: "发起人自行取消" },
    agent
  ).ok,
  "creator self-cancels draft"
);
assert(cancelMsgs(agent).length === beforeSelf, "self-cancel does not notify creator");

const dealId3 = createApprovedDeal("静音取消更名房", "0000203");
const muteRename = app.call(
  "dealExt.renames.create",
  {
    deal_id: dealId3,
    target: "customer",
    new_customer_name: "静音取消客户",
    reason: "静音频道取消测试",
  },
  agent
);
assert(muteRename.ok, "create mute-test rename");
assert(
  app.call("message.subscriptions.save", { channels: { deal_ext: false } }, agent).ok,
  "mute deal_ext channel"
);
const beforeMute = cancelMsgs(agent).length;
assert(
  app.call(
    "dealExt.renames.cancel",
    { id: data<any>(muteRename).id, reason: "静音场景由店长取消" },
    manager
  ).ok,
  "manager cancels while creator muted"
);
assert(cancelMsgs(agent).length === beforeMute, "muted deal_ext suppresses cancel message");

console.log(`Deal rename cancel notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
