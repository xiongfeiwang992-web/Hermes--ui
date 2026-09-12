import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "transfer-cancel-notify-smoke.db"));
const app = createApp(seeded.dbPath);
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
    (m) => m.kind === "employee_transfer" && m.title === "员工调动已取消"
  );
const todayDate = () => new Date().toISOString().slice(0, 10);

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAUser = data<any>(app.call("auth.me", {}, agentA));
const agentBUser = data<any>(app.call("auth.me", {}, agentB));
const storeB = seeded.storeB;

const transfer = app.call(
  "workforce.transfers.create",
  {
    user_id: agentAUser.id,
    to_store_id: storeB,
    handover_user_id: agentBUser.id,
    to_role: "agent",
    effective_date: todayDate(),
    reason: "取消通知测试调动",
  },
  manager
);
assert(transfer.ok, "manager creates pending transfer");
const transferId = data<any>(transfer).id;

const beforeAdmin = cancelMsgs(admin).length;
const beforeManager = cancelMsgs(manager).length;

assert(
  !app.call("workforce.transfers.cancel", { id: transferId }, agentA).ok,
  "agent cannot cancel transfer"
);

const cancelled = app.call("workforce.transfers.cancel", { id: transferId }, manager);
assert(cancelled.ok, "creator cancels pending transfer");
assert(data<any>(cancelled).status === "cancelled", "status cancelled");

const afterAdmin = cancelMsgs(admin);
assert(afterAdmin.length === beforeAdmin + 1, "admin receives cancel message");
assert(afterAdmin[0].ref_id === transferId, "message refs transfer");
assert(String(afterAdmin[0].body).includes("经纪人甲"), "body has employee name");
assert(String(afterAdmin[0].body).includes("二号店"), "body has target store");
assert(String(afterAdmin[0].body).includes("一号店长"), "body has actor name");
assert(cancelMsgs(manager).length === beforeManager, "creator does not self-notify");

assert(
  !app.call("workforce.transfers.cancel", { id: transferId }, manager).ok,
  "cannot cancel twice"
);

const transfer2 = app.call(
  "workforce.transfers.create",
  {
    user_id: agentAUser.id,
    to_store_id: storeB,
    handover_user_id: agentBUser.id,
    to_role: "agent",
    effective_date: todayDate(),
    reason: "管理员取消测",
  },
  manager
);
assert(transfer2.ok, "create second transfer");
const id2 = data<any>(transfer2).id;
const beforeMgr2 = cancelMsgs(manager).length;
const beforeAdmin2 = cancelMsgs(admin).length;
assert(
  app.call("workforce.transfers.cancel", { id: id2 }, admin).ok,
  "admin cancels manager-created transfer"
);
assert(
  cancelMsgs(manager).length === beforeMgr2 + 1,
  "creator receives cancel when admin cancels"
);
assert(
  cancelMsgs(admin).length === beforeAdmin2,
  "admin actor does not self-notify"
);

const transfer3 = app.call(
  "workforce.transfers.create",
  {
    user_id: agentAUser.id,
    to_store_id: storeB,
    handover_user_id: agentBUser.id,
    to_role: "agent",
    effective_date: todayDate(),
    reason: "静音取消测",
  },
  manager
);
assert(transfer3.ok, "create mute-test transfer");
assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, admin).ok,
  "mute hr channel for admin"
);
const beforeMute = cancelMsgs(admin).length;
assert(
  app.call("workforce.transfers.cancel", { id: data<any>(transfer3).id }, manager).ok,
  "cancel while admin muted"
);
assert(cancelMsgs(admin).length === beforeMute, "muted hr suppresses cancel message");

console.log(`Transfer cancel notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
