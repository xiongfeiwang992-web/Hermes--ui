import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "expense-smoke.db")).dbPath);
const receiptPath = path.resolve("/tmp", "expense-receipt.txt");
const voucherPath = path.resolve("/tmp", "expense-payment-voucher.txt");
fs.writeFileSync(receiptPath, "local expense receipt");
fs.writeFileSync(voucherPath, "local payment voucher");
let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentC = login("agent_c");
const managerId = data<any>(app.call("auth.me", {}, manager)).id;

check(
  !app.call(
    "expense.create",
    {
      title: "无效金额",
      category: "transport",
      amount: 0,
      expense_date: "2026-08-08",
    },
    agentA
  ).ok,
  "reject non-positive amount"
);
check(
  !app.call(
    "expense.create",
    {
      title: "无效类别",
      category: "unknown",
      amount: 10,
      expense_date: "2026-08-08",
    },
    agentA
  ).ok,
  "reject invalid expense category"
);
const request = app.call(
  "expense.create",
  {
    title: "客户带看交通费",
    category: "transport",
    amount: 86.5,
    expense_date: "2026-08-08",
    description: "往返出租车",
  },
  agentA
);
check(request.ok && data<any>(request).status === "draft", "employee creates expense draft");
const requestId = data<any>(request).id;
check(
  !app.call("expense.submit", { id: requestId }, agentA).ok,
  "receipt required before submission"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "expense_request",
      parent_id: requestId,
      category: "expense_receipt",
      name: "越权票据.txt",
      local_path: receiptPath,
    },
    agentB
  ).ok,
  "other employee cannot upload receipt"
);
const receipt = app.call(
  "attachment.add",
  {
    parent_type: "expense_request",
    parent_id: requestId,
    category: "expense_receipt",
    name: "交通费票据.txt",
    local_path: receiptPath,
  },
  agentA
);
check(receipt.ok, "applicant uploads local expense receipt");
check(
  data<any[]>(app.call(
    "attachment.list",
    { parent_type: "expense_request", parent_id: requestId },
    agentA
  )).length === 1,
  "applicant lists expense attachments"
);
check(
  !app.call(
    "attachment.list",
    { parent_type: "expense_request", parent_id: requestId },
    agentB
  ).ok,
  "expense attachments respect applicant visibility"
);
check(
  app.call("expense.submit", { id: requestId }, agentA).ok,
  "submit expense for approval"
);
check(
  !app.call(
    "expense.update",
    { id: requestId, amount: 99 },
    agentA
  ).ok,
  "pending expense cannot be edited"
);
check(
  !app.call(
    "expense.review",
    { id: requestId, status: "approved" },
    finance
  ).ok,
  "finance cannot approve expense"
);
check(
  !app.call(
    "expense.review",
    { id: requestId, status: "approved" },
    agentA
  ).ok,
  "applicant cannot approve expense"
);
check(
  app.call(
    "expense.review",
    { id: requestId, status: "approved" },
    manager
  ).ok,
  "store manager approves same-store expense"
);
check(
  !app.call(
    "expense.pay",
    { id: requestId, payment_method: "bank", payment_reference: "" },
    finance
  ).ok,
  "bank payment requires reference"
);
check(
  !app.call(
    "expense.pay",
    { id: requestId, payment_method: "cash" },
    manager
  ).ok,
  "store manager cannot register payment"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "expense_request",
      parent_id: requestId,
      category: "payment_voucher",
      name: "付款凭证.txt",
      local_path: voucherPath,
    },
    finance
  ).ok,
  "finance uploads payment voucher"
);
check(
  app.call(
    "expense.pay",
    { id: requestId, payment_method: "bank", payment_reference: "PAY-20260808-001" },
    finance
  ).ok,
  "finance pays approved expense"
);
const paid = data<any[]>(app.call("expense.list", { status: "paid" }, agentA))[0];
check(
  paid.id === requestId &&
    paid.receipt_count === 1 &&
    paid.voucher_count === 1 &&
    paid.payment_reference === "PAY-20260808-001",
  "paid request includes receipt voucher and payment reference"
);
check(
  !app.call("expense.cancel", { id: requestId }, agentA).ok,
  "paid expense cannot be cancelled"
);
check(
  data<any[]>(app.call("expense.list", {}, agentB)).length === 0,
  "employee sees only own reimbursements"
);
check(
  data<any[]>(app.call("expense.list", {}, manager)).some((row) => row.id === requestId),
  "manager sees same-store reimbursements"
);
check(
  data<any[]>(app.call("expense.list", {}, finance)).some((row) => row.id === requestId),
  "finance sees company reimbursements"
);
const agentMessages = data<any[]>(app.call("message.list", {}, agentA));
check(
  agentMessages.some((message) => message.kind === "expense_review") &&
    agentMessages.some((message) => message.kind === "expense_paid"),
  "applicant receives approval and payment messages"
);
check(
  data<any[]>(app.call("message.list", {}, manager)).some(
    (message) => message.kind === "expense_pending"
  ),
  "store manager receives pending approval message"
);

const rejected = app.call(
  "expense.create",
  {
    title: "办公耗材",
    category: "office",
    amount: 120,
    expense_date: "2026-08-07",
  },
  agentB
);
check(rejected.ok, "create expense for rejection flow");
const rejectedId = data<any>(rejected).id;
check(
  app.call(
    "attachment.add",
    {
      parent_type: "expense_request",
      parent_id: rejectedId,
      category: "expense_receipt",
      name: "办公票据.txt",
      local_path: receiptPath,
    },
    agentB
  ).ok && app.call("expense.submit", { id: rejectedId }, agentB).ok,
  "attach and submit rejection-flow expense"
);
check(
  !app.call(
    "expense.review",
    { id: rejectedId, status: "rejected", reason: "" },
    manager
  ).ok,
  "expense rejection requires reason"
);
check(
  app.call(
    "expense.review",
    { id: rejectedId, status: "rejected", reason: "用途说明不足" },
    manager
  ).ok,
  "manager rejects expense with reason"
);
check(
  app.call(
    "expense.update",
    { id: rejectedId, description: "补充办公耗材清单" },
    agentB
  ).ok,
  "applicant edits rejected expense back to draft"
);
check(
  app.call("expense.cancel", { id: rejectedId }, agentB).ok,
  "applicant cancels draft expense"
);

const crossStore = app.call(
  "expense.create",
  {
    title: "二号店交通费",
    category: "travel",
    amount: 300,
    expense_date: "2026-08-08",
  },
  agentC
);
check(crossStore.ok, "cross-store employee creates own expense");
check(
  !data<any[]>(app.call("expense.list", {}, manager)).some(
    (row) => row.id === data<any>(crossStore).id
  ),
  "manager cannot see another store expense"
);
check(
  data<any[]>(app.call("expense.list", {}, admin)).some(
    (row) => row.id === data<any>(crossStore).id
  ),
  "admin sees company-wide expenses"
);

const managerRequest = app.call(
  "expense.create",
  {
    title: "店长差旅费",
    category: "travel",
    amount: 500,
    expense_date: "2026-08-06",
  },
  manager
);
const managerRequestId = data<any>(managerRequest).id;
check(managerRequest.ok, "manager creates own expense");
check(
  app.call(
    "attachment.add",
    {
      parent_type: "expense_request",
      parent_id: managerRequestId,
      category: "expense_receipt",
      name: "差旅票据.txt",
      local_path: receiptPath,
    },
    manager
  ).ok && app.call("expense.submit", { id: managerRequestId }, manager).ok,
  "manager attaches and submits own expense"
);
check(
  !app.call(
    "expense.review",
    { id: managerRequestId, status: "approved" },
    manager
  ).ok,
  "manager cannot self-approve"
);
check(
  app.call(
    "expense.review",
    { id: managerRequestId, status: "approved" },
    admin
  ).ok,
  "admin approves manager expense"
);
check(
  app.call(
    "expense.pay",
    { id: managerRequestId, payment_method: "cash" },
    finance
  ).ok,
  "finance records cash payment without reference"
);
check(
  data<any[]>(app.call("expense.list", {}, manager)).some(
    (row) => row.id === managerRequestId && row.status === "paid"
  ),
  "manager sees own paid expense"
);
check(managerId !== "", "manager identity available for segregation checks");

console.log(`Expense smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
