import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "expense-cancel-notify-smoke.db")).dbPath);
const receiptPath = path.resolve("/tmp", "expense-cancel-notify-receipt.txt");
fs.writeFileSync(receiptPath, "expense cancel notify receipt");

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
    (m) => m.kind === "expense_review" && m.title === "费用报销已取消"
  );

function createPendingExpense(agentToken: string, title: string, amount: number) {
  const created = app.call(
    "expense.create",
    {
      title,
      category: "transport",
      amount,
      expense_date: "2026-08-08",
      description: "取消通知测试",
    },
    agentToken
  );
  assert(created.ok, `create ${title}`);
  const id = data<any>(created).id;
  assert(
    app.call(
      "attachment.add",
      {
        parent_type: "expense_request",
        parent_id: id,
        category: "expense_receipt",
        name: "票据.txt",
        local_path: receiptPath,
      },
      agentToken
    ).ok,
    `attach ${title}`
  );
  assert(app.call("expense.submit", { id }, agentToken).ok, `submit ${title}`);
  return id;
}

const agentA = login("agent_a");
const manager = login("manager");

const pendingId = createPendingExpense(agentA, "取消通知交通费", 88.5);
const beforeManager = cancelMsgs(manager).length;
const beforeAgent = cancelMsgs(agentA).length;

const cancelled = app.call("expense.cancel", { id: pendingId }, agentA);
assert(cancelled.ok, "applicant cancels pending expense");
assert(data<any>(cancelled).status === "cancelled", "status cancelled");

const afterManager = cancelMsgs(manager);
assert(afterManager.length === beforeManager + 1, "manager receives cancel message");
assert(afterManager[0].ref_id === pendingId, "message refs expense");
assert(String(afterManager[0].body).includes("取消通知交通费"), "body has title");
assert(String(afterManager[0].body).includes("88.50"), "body has amount");
assert(String(afterManager[0].body).includes("经纪人甲"), "body has applicant name");
assert(cancelMsgs(agentA).length === beforeAgent, "applicant does not self-notify");

assert(
  !app.call("expense.cancel", { id: pendingId }, agentA).ok,
  "cannot cancel twice"
);

const draft = app.call(
  "expense.create",
  {
    title: "草稿取消不通知",
    category: "transport",
    amount: 20,
    expense_date: "2026-08-09",
  },
  agentA
);
assert(draft.ok, "create draft expense");
const beforeDraft = cancelMsgs(manager).length;
assert(
  app.call("expense.cancel", { id: data<any>(draft).id }, agentA).ok,
  "cancel draft expense"
);
assert(
  cancelMsgs(manager).length === beforeDraft,
  "draft cancel does not notify manager"
);

const mutedId = createPendingExpense(agentA, "静音取消报销", 45);
assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, manager).ok,
  "mute hr channel"
);
const beforeMute = cancelMsgs(manager).length;
assert(
  app.call("expense.cancel", { id: mutedId }, agentA).ok,
  "cancel pending while muted"
);
assert(cancelMsgs(manager).length === beforeMute, "muted hr suppresses cancel message");

console.log(`Expense cancel notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
