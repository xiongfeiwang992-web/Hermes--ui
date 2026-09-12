import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "expense-update-notify-smoke.db")).dbPath
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
    (m) => m.kind === "business_record_status" && m.title === "费用报销草稿已更新"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const cross = login("agent_c");

const created = app.call(
  "expense.create",
  {
    title: "报销更新通知交通费",
    category: "transport",
    amount: 70,
    expense_date: "2026-09-01",
    description: "往返公交",
  },
  agent
);
assert(created.ok, "agent creates expense draft");
const expenseId = data<any>(created).id;

const beforeAdmin = updateMsgs(admin).length;
const beforeManager = updateMsgs(manager).length;
const beforeAgent = updateMsgs(agent).length;
const beforeCross = updateMsgs(cross).length;
const updated = app.call(
  "expense.update",
  {
    id: expenseId,
    title: "报销更新通知交通费改",
    amount: 88.5,
  },
  agent
);
assert(updated.ok, "agent updates expense draft");
assert(updateMsgs(admin).length === beforeAdmin + 1, "admin receives update message");
assert(updateMsgs(manager).length === beforeManager + 1, "manager receives update message");
assert(updateMsgs(agent).length === beforeAgent, "updater skips self");
assert(updateMsgs(cross).length === beforeCross, "cross-store agent not notified");
assert(
  updateMsgs(manager).some(
    (m) =>
      m.ref_id === expenseId &&
      m.ref_type === "expense_request" &&
      String(m.body).includes("报销更新通知交通费改") &&
      String(m.body).includes("88.50")
  ),
  "update message body"
);

const beforeSelfAdmin = updateMsgs(admin).length;
const beforeSelfMgr = updateMsgs(manager).length;
assert(
  app.call(
    "expense.update",
    { id: expenseId, title: "管理员改报销草稿", amount: 91 },
    admin
  ).ok,
  "admin updates expense draft"
);
assert(updateMsgs(admin).length === beforeSelfAdmin, "admin actor skips self");
assert(updateMsgs(manager).length === beforeSelfMgr + 1, "manager notified for admin update");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = updateMsgs(manager).length;
assert(
  app.call(
    "expense.update",
    { id: expenseId, title: "静音报销更新", amount: 50 },
    agent
  ).ok,
  "update while muted"
);
assert(updateMsgs(manager).length === beforeMute, "muted other suppresses update message");

console.log(`Expense update notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
