import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "deal-complaint-withdraw-notify-smoke.db")).dbPath
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
const withdrawMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "deal_complaint" && m.title === "成交投诉已撤回"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;

function createApprovedDeal(title: string, phoneSuffix: string) {
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "撤回通知小区",
      price: 220,
      owner_name: "业主撤回测",
      owner_phone: `1377${phoneSuffix}`,
      status: "available",
    },
    agent
  );
  assert(house.ok, `create house ${title}`);
  const customer = app.call(
    "customer.create",
    { name: `客户${phoneSuffix}`, phone: `1387${phoneSuffix}`, intent: "buy" },
    agent
  );
  assert(customer.ok, `create customer ${phoneSuffix}`);
  const deal = app.call(
    "deal.create",
    {
      house_id: data<any>(house).id,
      customer_id: data<any>(customer).id,
      contract_price: 200,
      commission_owner: 6000,
      commission_customer: 6000,
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

const dealId = createApprovedDeal("撤回通知成交房", "0000101");
const complaint = app.call(
  "dealExt.complaints.create",
  {
    deal_id: dealId,
    category: "commission",
    title: "撤回通知佣金争议",
    description: "对佣金分配有异议需要复核后撤回",
  },
  agent
);
assert(complaint.ok, "agent creates open complaint");
const complaintId = data<any>(complaint).id;

const beforeManager = withdrawMsgs(manager).length;
const beforeAdmin = withdrawMsgs(admin).length;
const beforeAgent = withdrawMsgs(agent).length;

const withdrawn = app.call(
  "dealExt.complaints.withdraw",
  { id: complaintId, reason: "已当面沟通解决" },
  agent
);
assert(withdrawn.ok, "agent withdraws open complaint");
assert(data<any>(withdrawn).status === "withdrawn", "status withdrawn");

const afterManager = withdrawMsgs(manager);
assert(afterManager.length === beforeManager + 1, "manager receives withdraw message");
assert(afterManager[0].ref_id === complaintId, "message refs complaint");
assert(String(afterManager[0].body).includes("撤回通知佣金争议"), "body has title");
assert(String(afterManager[0].body).includes("已当面沟通解决"), "body has reason");
assert(withdrawMsgs(admin).length === beforeAdmin + 1, "admin receives withdraw message");
assert(withdrawMsgs(agent).length === beforeAgent, "withdrawer does not self-notify");
assert(
  !app.call(
    "dealExt.complaints.withdraw",
    { id: complaintId, reason: "再次撤回" },
    agent
  ).ok,
  "cannot withdraw twice"
);

const dealId2 = createApprovedDeal("店长撤回成交房", "0000102");
const complaint2 = app.call(
  "dealExt.complaints.create",
  {
    deal_id: dealId2,
    category: "service",
    title: "店长撤回服务投诉",
    description: "服务态度问题由店长代为撤回",
  },
  agent
);
assert(complaint2.ok, "create second complaint");
const id2 = data<any>(complaint2).id;
const beforeAgent2 = withdrawMsgs(agent).length;
const beforeManager2 = withdrawMsgs(manager).length;
assert(
  app.call(
    "dealExt.complaints.withdraw",
    { id: id2, reason: "店长核实已解决" },
    manager
  ).ok,
  "manager withdraws agent complaint"
);
assert(
  withdrawMsgs(agent).length === beforeAgent2 + 1,
  "creator receives when manager withdraws"
);
assert(
  withdrawMsgs(manager).length === beforeManager2,
  "manager actor does not self-notify"
);

const dealId3 = createApprovedDeal("静音撤回成交房", "0000103");
const complaint3 = app.call(
  "dealExt.complaints.create",
  {
    deal_id: dealId3,
    category: "payment",
    title: "静音撤回付款投诉",
    description: "付款争议用于静音频道测试",
  },
  agent
);
assert(complaint3.ok, "create mute-test complaint");
assert(
  app.call("message.subscriptions.save", { channels: { deal_ext: false } }, manager).ok,
  "mute deal_ext channel"
);
const beforeMute = withdrawMsgs(manager).length;
assert(
  app.call(
    "dealExt.complaints.withdraw",
    { id: data<any>(complaint3).id, reason: "静音场景撤回" },
    agent
  ).ok,
  "withdraw while manager muted"
);
assert(
  withdrawMsgs(manager).length === beforeMute,
  "muted deal_ext suppresses withdraw message"
);

console.log(
  `Deal complaint withdraw notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
