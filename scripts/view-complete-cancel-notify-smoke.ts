import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "view-complete-cancel-notify-smoke.db")).dbPath
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
const msgs = (token: string, title: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "view_non_holder" && m.title === title
  );

const agentA = login("agent_a");
const agentB = login("agent_b");
const manager = login("manager");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

let phoneSeq = 500;
function createHouse(token: string, title: string) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "带看状态小区",
      price: 180,
      owner_name: "带看业主",
      owner_phone: `13980${String(phoneSeq).padStart(6, "0")}`,
      status: "available",
    },
    token
  );
  assert(house.ok, `create house ${title}`);
  return data<any>(house).id;
}
function createCustomer(token: string, name: string) {
  phoneSeq += 1;
  const customer = app.call(
    "customer.create",
    {
      name,
      phone: `13880${String(phoneSeq).padStart(6, "0")}`,
      intent: "buy",
      budget_min: 100,
      budget_max: 300,
    },
    token
  );
  assert(customer.ok, `create customer ${name}`);
  return data<any>(customer).id;
}

const peerHouse = createHouse(agentB, "完成通知盘-乙");
const peerCustomer = createCustomer(agentA, "完成客户甲");
const completeView = app.call(
  "view.create",
  {
    customer_id: peerCustomer,
    house_id: peerHouse,
    view_at: new Date().toISOString(),
    accompany_ids: [managerId],
  },
  agentA
);
assert(completeView.ok, "create complete view");
const completeViewId = data<any>(completeView).id;

assert(
  !app.call("view.complete", { id: completeViewId, feedback: "pending" }, agentA).ok,
  "complete requires feedback"
);
assert(
  !app.call(
    "view.complete",
    { id: completeViewId, feedback: "interested" },
    agentB
  ).ok,
  "peer cannot complete others view"
);

const beforeB = msgs(agentB, "带看已完成").length;
const beforeA = msgs(agentA, "带看已完成").length;
const beforeM = msgs(manager, "带看已完成").length;
assert(
  app.call(
    "view.complete",
    { id: completeViewId, feedback: "interested", content: "客户有意向" },
    agentA
  ).ok,
  "agent completes view"
);
assert(msgs(agentB, "带看已完成").length === beforeB + 1, "house agent receives complete");
assert(msgs(manager, "带看已完成").length === beforeM + 1, "accompany receives complete");
assert(msgs(agentA, "带看已完成").length === beforeA, "actor does not self-notify complete");
assert(
  msgs(agentB, "带看已完成").some(
    (m) =>
      m.ref_id === completeViewId &&
      String(m.body).includes("完成通知盘-乙") &&
      String(m.body).includes("完成客户甲") &&
      String(m.body).includes("interested")
  ),
  "complete message body"
);

const selfHouse = createHouse(agentA, "自盘完成无通知");
const selfCustomer = createCustomer(agentA, "自客完成");
const selfView = app.call(
  "view.create",
  {
    customer_id: selfCustomer,
    house_id: selfHouse,
    view_at: new Date().toISOString(),
  },
  agentA
);
assert(selfView.ok, "create self view");
const beforeSelf = msgs(agentA, "带看已完成").length;
assert(
  app.call(
    "view.complete",
    { id: data<any>(selfView).id, feedback: "rejected" },
    agentA
  ).ok,
  "complete self view"
);
assert(msgs(agentA, "带看已完成").length === beforeSelf, "self complete skips all recipients");

const cancelHouse = createHouse(agentB, "取消通知盘-乙");
const cancelCustomer = createCustomer(agentA, "取消客户甲");
const cancelView = app.call(
  "view.create",
  {
    customer_id: cancelCustomer,
    house_id: cancelHouse,
    view_at: new Date().toISOString(),
    accompany_ids: [agentBId],
  },
  agentA
);
assert(cancelView.ok, "create cancel view");
const cancelViewId = data<any>(cancelView).id;
assert(!app.call("view.cancel", { id: cancelViewId, reason: "" }, agentA).ok, "cancel requires reason");

const beforeCancelA = msgs(agentA, "带看已取消").length;
const beforeCancelB = msgs(agentB, "带看已取消").length;
const beforeCancelM = msgs(manager, "带看已取消").length;
assert(
  app.call("view.cancel", { id: cancelViewId, reason: "客户临时改期" }, manager).ok,
  "manager cancels view"
);
assert(msgs(agentA, "带看已取消").length === beforeCancelA + 1, "viewer/customer agent receives cancel");
assert(msgs(agentB, "带看已取消").length === beforeCancelB + 1, "house/accompany receives cancel");
assert(msgs(manager, "带看已取消").length === beforeCancelM, "cancel actor does not self-notify");
assert(
  msgs(agentA, "带看已取消").some(
    (m) =>
      m.ref_id === cancelViewId &&
      String(m.body).includes("取消通知盘-乙") &&
      String(m.body).includes("取消客户甲") &&
      String(m.body).includes("客户临时改期")
  ),
  "cancel message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { follow: false } }, agentB).ok,
  "mute follow"
);
const muteHouse = createHouse(agentB, "静音完成盘");
const muteCustomer = createCustomer(agentA, "静音客户");
const muteView = app.call(
  "view.create",
  {
    customer_id: muteCustomer,
    house_id: muteHouse,
    view_at: new Date().toISOString(),
  },
  agentA
);
assert(muteView.ok, "create muted view");
const beforeMute = msgs(agentB, "带看已完成").length;
assert(
  app.call(
    "view.complete",
    { id: data<any>(muteView).id, feedback: "considering" },
    agentA
  ).ok,
  "complete while muted"
);
assert(msgs(agentB, "带看已完成").length === beforeMute, "muted follow suppresses complete message");

void agentAId;

console.log(
  `View complete/cancel notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
