import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "expense-create-notify-smoke.db")).dbPath
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
const draftMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "费用报销草稿已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const cross = login("agent_c");

const beforeAdmin = draftMsgs(admin).length;
const beforeManager = draftMsgs(manager).length;
const beforeAgent = draftMsgs(agent).length;
const beforeCross = draftMsgs(cross).length;
const created = app.call(
  "expense.create",
  {
    title: "报销草稿通知交通费",
    category: "transport",
    amount: 86.5,
    expense_date: "2026-09-01",
    description: "往返出租车",
  },
  agent
);
assert(created.ok, "agent creates expense draft");
const expenseId = data<any>(created).id;
assert(draftMsgs(admin).length === beforeAdmin + 1, "admin receives draft message");
assert(draftMsgs(manager).length === beforeManager + 1, "manager receives draft message");
assert(draftMsgs(agent).length === beforeAgent, "creator skips self");
assert(draftMsgs(cross).length === beforeCross, "cross-store agent not notified");
assert(
  draftMsgs(manager).some(
    (m) =>
      m.ref_id === expenseId &&
      m.ref_type === "expense_request" &&
      String(m.body).includes("报销草稿通知交通费") &&
      String(m.body).includes("86.50")
  ),
  "draft message body"
);

const beforeUpdate = draftMsgs(manager).length;
assert(
  app.call(
    "expense.update",
    {
      id: expenseId,
      title: "报销草稿通知交通费改",
      amount: 90,
    },
    agent
  ).ok,
  "agent updates expense draft"
);
assert(draftMsgs(manager).length === beforeUpdate, "update does not re-notify");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = draftMsgs(manager).length;
assert(
  app.call(
    "expense.create",
    {
      title: "静音报销草稿",
      category: "office",
      amount: 40,
      expense_date: "2026-09-02",
    },
    agent
  ).ok,
  "create while muted"
);
assert(draftMsgs(manager).length === beforeMute, "muted other suppresses draft message");

console.log(`Expense create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
