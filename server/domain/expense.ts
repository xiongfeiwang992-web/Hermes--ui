import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const CATEGORIES = new Set([
  "transport",
  "travel",
  "office",
  "marketing",
  "hospitality",
  "other",
]);

function visible(user: SessionUser, row: any): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  if (user.role === "store_manager") return row.store_id === user.store_id;
  return row.applicant_user_id === user.id;
}

function getRequest(db: Db, user: SessionUser, id: string): any | null {
  const row = db
    .prepare(`SELECT * FROM expense_requests WHERE id=? AND company_id=?`)
    .get(id, user.company_id) as any;
  return row && visible(user, row) ? row : null;
}

function validateInput(payload: any): string | null {
  if (!String(payload.title || "").trim()) return "报销事由必填";
  if (!CATEGORIES.has(payload.category)) return "费用类别无效";
  if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0)
    return "报销金额须大于 0";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.expense_date || "")))
    return "费用日期无效";
  return null;
}

export function listExpenses(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT e.*, applicant.display_name AS applicant_name,
       approver.display_name AS approver_name, payer.display_name AS payer_name,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='expense_request' AND a.parent_id=e.id
        AND a.category='expense_receipt') AS receipt_count,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='expense_request' AND a.parent_id=e.id
        AND a.category='payment_voucher') AS voucher_count
       FROM expense_requests e
       JOIN users applicant ON applicant.id=e.applicant_user_id
       LEFT JOIN users approver ON approver.id=e.approved_by
       LEFT JOIN users payer ON payer.id=e.paid_by
       WHERE e.company_id=? ORDER BY e.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.category) rows = rows.filter((row) => row.category === payload.category);
  if (payload.applicant_user_id)
    rows = rows.filter((row) => row.applicant_user_id === payload.applicant_user_id);
  return { ok: true, data: rows };
}

export function createExpense(db: Db, user: SessionUser, payload: any): ApiResult {
  const error = validateInput(payload);
  if (error) return { ok: false, message: error };
  const id = nextId("EXP");
  const now = nowIso();
  db.prepare(
    `INSERT INTO expense_requests(
      id, company_id, store_id, applicant_user_id, title, category,
      amount, expense_date, description, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    user.id,
    String(payload.title).trim(),
    payload.category,
    Number(payload.amount),
    payload.expense_date,
    String(payload.description || "").trim() || null,
    now,
    now
  );
  writeAudit(db, user, "expense.create", "expense_request", id, {
    amount: Number(payload.amount),
    category: payload.category,
  });
  let recipients = db
    .prepare(
      `SELECT id, store_id, role FROM users WHERE company_id=? AND status='active'
       AND role IN ('admin', 'store_manager')`
    )
    .all(user.company_id) as any[];
  recipients = recipients.filter(
    (recipient) => recipient.role === "admin" || recipient.store_id === user.store_id
  );
  const title = String(payload.title).trim();
  const body = `${title} · ¥${Number(payload.amount).toFixed(2)}`;
  for (const recipient of recipients) {
    if (recipient.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: user.store_id || recipient.store_id,
      user_id: recipient.id,
      title: "费用报销草稿已创建",
      body,
      kind: "business_record_status",
      ref_type: "expense_request",
      ref_id: id,
    });
  }
  return { ok: true, data: { id, status: "draft" } };
}

export function updateExpense(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = getRequest(db, user, payload.id);
  if (!row) return { ok: false, message: "报销单不存在或无权限", code: 403 };
  if (!["draft", "rejected"].includes(row.status))
    return { ok: false, message: "当前状态不可编辑" };
  if (!(user.role === "admin" || row.applicant_user_id === user.id))
    return { ok: false, message: "仅申请人可编辑", code: 403 };
  const merged = {
    title: payload.title ?? row.title,
    category: payload.category ?? row.category,
    amount: payload.amount ?? row.amount,
    expense_date: payload.expense_date ?? row.expense_date,
  };
  const error = validateInput(merged);
  if (error) return { ok: false, message: error };
  db.prepare(
    `UPDATE expense_requests SET title=?, category=?, amount=?, expense_date=?,
     description=?, status='draft', reject_reason=NULL, updated_at=? WHERE id=?`
  ).run(
    String(merged.title).trim(),
    merged.category,
    Number(merged.amount),
    merged.expense_date,
    payload.description ?? row.description,
    nowIso(),
    row.id
  );
  writeAudit(db, user, "expense.update", "expense_request", row.id);
  return { ok: true, data: { id: row.id, status: "draft" } };
}

export function submitExpense(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = getRequest(db, user, payload.id);
  if (!row) return { ok: false, message: "报销单不存在或无权限", code: 403 };
  if (!(user.role === "admin" || row.applicant_user_id === user.id))
    return { ok: false, message: "仅申请人可提交", code: 403 };
  if (!["draft", "rejected"].includes(row.status))
    return { ok: false, message: "当前状态不可提交" };
  const receipt = db
    .prepare(
      `SELECT COUNT(*) AS c FROM file_attachments
       WHERE company_id=? AND parent_type='expense_request'
       AND parent_id=? AND category='expense_receipt'`
    )
    .get(user.company_id, row.id) as { c: number };
  if (!receipt.c) return { ok: false, message: "请先上传至少一份费用票据" };
  const now = nowIso();
  db.prepare(
    `UPDATE expense_requests SET status='pending', reject_reason=NULL, updated_at=? WHERE id=?`
  ).run(now, row.id);
  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND store_id=?
       AND role='store_manager' AND status='active' AND id<>?`
    )
    .all(user.company_id, row.store_id, row.applicant_user_id) as any[];
  for (const manager of managers) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: manager.id,
      title: "费用报销待审批",
      body: `${row.title} · ¥${Number(row.amount).toFixed(2)}`,
      kind: "expense_pending",
      ref_type: "expense_request",
      ref_id: row.id,
    });
  }
  writeAudit(db, user, "expense.submit", "expense_request", row.id);
  return { ok: true, data: { id: row.id, status: "pending" } };
}

export function reviewExpense(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = getRequest(db, user, payload.id);
  if (!row) return { ok: false, message: "报销单不存在或无权限", code: 403 };
  if (
    !(
      user.role === "admin" ||
      (user.role === "store_manager" && user.store_id === row.store_id)
    )
  )
    return { ok: false, message: "无审批权限", code: 403 };
  if (row.applicant_user_id === user.id)
    return { ok: false, message: "申请人不可审批自己的报销单" };
  if (row.status !== "pending") return { ok: false, message: "仅待审批报销单可处理" };
  if (!["approved", "rejected"].includes(payload.status))
    return { ok: false, message: "审批状态无效" };
  const reason = String(payload.reason || "").trim();
  if (payload.status === "rejected" && !reason)
    return { ok: false, message: "驳回原因必填" };
  const now = nowIso();
  db.prepare(
    `UPDATE expense_requests SET status=?, reject_reason=?, approved_by=?,
     approved_at=?, updated_at=? WHERE id=?`
  ).run(payload.status, payload.status === "rejected" ? reason : null, user.id, now, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.applicant_user_id,
    title: payload.status === "approved" ? "费用报销已审批" : "费用报销已驳回",
    body: `${row.title}${reason ? `：${reason}` : ""}`,
    kind: "expense_review",
    ref_type: "expense_request",
    ref_id: row.id,
  });
  writeAudit(db, user, `expense.${payload.status}`, "expense_request", row.id, { reason });
  return { ok: true, data: { id: row.id, status: payload.status } };
}

export function payExpense(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "finance"))
    return { ok: false, message: "无付款权限", code: 403 };
  const row = getRequest(db, user, payload.id);
  if (!row) return { ok: false, message: "报销单不存在或无权限", code: 403 };
  if (row.status !== "approved") return { ok: false, message: "仅已审批报销单可付款" };
  if (row.applicant_user_id === user.id)
    return { ok: false, message: "申请人不可给自己的报销单付款" };
  if (!["bank", "cash", "other"].includes(payload.payment_method))
    return { ok: false, message: "付款方式无效" };
  const reference = String(payload.payment_reference || "").trim();
  if (payload.payment_method !== "cash" && !reference)
    return { ok: false, message: "非现金付款须填写流水号" };
  const now = nowIso();
  db.prepare(
    `UPDATE expense_requests SET status='paid', paid_by=?, paid_at=?,
     payment_method=?, payment_reference=?, updated_at=? WHERE id=?`
  ).run(user.id, now, payload.payment_method, reference || null, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.applicant_user_id,
    title: "费用报销已付款",
    body: `${row.title} · ¥${Number(row.amount).toFixed(2)}`,
    kind: "expense_paid",
    ref_type: "expense_request",
    ref_id: row.id,
  });
  writeAudit(db, user, "expense.pay", "expense_request", row.id, {
    amount: row.amount,
    payment_method: payload.payment_method,
    payment_reference: reference || null,
  });
  return { ok: true, data: { id: row.id, status: "paid" } };
}

export function cancelExpense(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = getRequest(db, user, payload.id);
  if (!row) return { ok: false, message: "报销单不存在或无权限", code: 403 };
  if (!(user.role === "admin" || row.applicant_user_id === user.id))
    return { ok: false, message: "仅申请人可取消", code: 403 };
  if (!["draft", "rejected", "pending"].includes(row.status))
    return { ok: false, message: "当前状态不可取消" };
  const now = nowIso();
  db.prepare(
    `UPDATE expense_requests SET status='cancelled', cancelled_at=?, updated_at=? WHERE id=?`
  ).run(now, now, row.id);
  writeAudit(db, user, "expense.cancel", "expense_request", row.id);
  return { ok: true, data: { id: row.id, status: "cancelled" } };
}
