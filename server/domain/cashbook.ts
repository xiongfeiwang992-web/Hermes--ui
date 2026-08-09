import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso, todayDate } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const INCOME_CATEGORIES = new Set(["commission", "deposit", "service", "other_income"]);
const EXPENSE_CATEGORIES = new Set([
  "office",
  "marketing",
  "salary",
  "rent",
  "tax",
  "reimbursement",
  "other_expense",
]);
const PAYMENT_METHODS = new Set(["cash", "bank", "wechat", "alipay", "other"]);

function canRead(user: SessionUser): boolean {
  return ["admin", "finance", "store_manager"].includes(user.role);
}

function visible(user: SessionUser, row: any): boolean {
  return user.role === "admin" || user.role === "finance" || row.store_id === user.store_id;
}

function scopedRows(db: Db, user: SessionUser, payload: any = {}): any[] {
  let rows = db
    .prepare(
      `SELECT e.*, s.name AS store_name, d.deal_date, creator.display_name AS creator_name,
       voider.display_name AS voider_name,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='cashbook_entry' AND a.parent_id=e.id
        AND a.category='cashbook_voucher') AS voucher_count
       FROM cashbook_entries e
       JOIN stores s ON s.id=e.store_id
       LEFT JOIN deals d ON d.id=e.deal_id
       JOIN users creator ON creator.id=e.created_by
       LEFT JOIN users voider ON voider.id=e.voided_by
       WHERE e.company_id=? ORDER BY e.occurred_at DESC, e.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row));
  if (payload.store_id) rows = rows.filter((row) => row.store_id === payload.store_id);
  if (payload.direction) rows = rows.filter((row) => row.direction === payload.direction);
  if (payload.category) rows = rows.filter((row) => row.category === payload.category);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.start_at) rows = rows.filter((row) => row.occurred_at >= payload.start_at);
  if (payload.end_at) rows = rows.filter((row) => row.occurred_at <= payload.end_at);
  return rows;
}

export function listCashbook(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!canRead(user)) return { ok: false, message: "无权限", code: 403 };
  return { ok: true, data: scopedRows(db, user, payload) };
}

export function cashbookOptions(db: Db, user: SessionUser): ApiResult {
  if (!canRead(user)) return { ok: false, message: "无权限", code: 403 };
  let stores = db
    .prepare(`SELECT id, name FROM stores WHERE company_id=? AND status='active' ORDER BY name`)
    .all(user.company_id) as any[];
  let deals = db
    .prepare(
      `SELECT id, store_id, deal_date, commission_total FROM deals
       WHERE company_id=? AND status='approved' ORDER BY deal_date DESC`
    )
    .all(user.company_id) as any[];
  if (user.role === "store_manager") {
    stores = stores.filter((store) => store.id === user.store_id);
    deals = deals.filter((deal) => deal.store_id === user.store_id);
  }
  return { ok: true, data: { stores, deals } };
}

export function createCashbook(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "finance"))
    return { ok: false, message: "无登记权限", code: 403 };
  if (!["income", "expense"].includes(payload.direction))
    return { ok: false, message: "收支方向无效" };
  const allowed =
    payload.direction === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (!allowed.has(payload.category)) return { ok: false, message: "收支类别无效" };
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: "金额须大于 0" };
  if (!PAYMENT_METHODS.has(payload.payment_method))
    return { ok: false, message: "收付方式无效" };
  const occurredMs = Date.parse(payload.occurred_at);
  if (!Number.isFinite(occurredMs)) return { ok: false, message: "发生时间无效" };
  const storeId = payload.store_id || user.store_id;
  const store = db
    .prepare(`SELECT * FROM stores WHERE id=? AND company_id=? AND status='active'`)
    .get(storeId, user.company_id) as any;
  if (!store) return { ok: false, message: "门店无效" };
  if (payload.deal_id) {
    const deal = db
      .prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`)
      .get(payload.deal_id, user.company_id) as any;
    if (!deal || deal.store_id !== storeId)
      return { ok: false, message: "关联成交不存在或不属于所选门店" };
  }
  const id = nextId("CB");
  const now = nowIso();
  db.prepare(
    `INSERT INTO cashbook_entries(
      id, company_id, store_id, direction, category, amount, occurred_at,
      counterparty, payment_method, deal_id, note, status,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    storeId,
    payload.direction,
    payload.category,
    amount,
    new Date(occurredMs).toISOString(),
    String(payload.counterparty || "").trim() || null,
    payload.payment_method,
    payload.deal_id || null,
    String(payload.note || "").trim() || null,
    user.id,
    now,
    now
  );
  writeAudit(db, user, "cashbook.create", "cashbook_entry", id, {
    direction: payload.direction,
    category: payload.category,
    amount,
    store_id: storeId,
    deal_id: payload.deal_id || null,
  });
  return { ok: true, data: { id, status: "confirmed" } };
}

export function voidCashbook(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "finance"))
    return { ok: false, message: "无作废权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM cashbook_entries WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !visible(user, row))
    return { ok: false, message: "收支记录不存在或无权限", code: 403 };
  if (row.status !== "confirmed") return { ok: false, message: "该记录已作废" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "作废原因必填" };
  const now = nowIso();
  db.prepare(
    `UPDATE cashbook_entries SET status='voided', void_reason=?, voided_by=?,
     voided_at=?, updated_at=? WHERE id=?`
  ).run(reason, user.id, now, now, row.id);
  writeAudit(db, user, "cashbook.void", "cashbook_entry", row.id, {
    reason,
    direction: row.direction,
    amount: row.amount,
  });
  if (row.created_by && row.created_by !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.created_by,
      title: "收支流水已作废",
      body: `${row.direction === "income" ? "收入" : "支出"} ¥${Number(row.amount).toFixed(2)}${row.counterparty ? ` · ${row.counterparty}` : ""}：${reason}`,
      kind: "business_record_status",
      ref_type: "cashbook_entry",
      ref_id: row.id,
    });
  }
  return { ok: true, data: { id: row.id, status: "voided" } };
}

export function summarizeCashbook(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!canRead(user)) return { ok: false, message: "无权限", code: 403 };
  const rows = scopedRows(db, user, { ...payload, status: "confirmed" });
  const income = rows
    .filter((row) => row.direction === "income")
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const expense = rows
    .filter((row) => row.direction === "expense")
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const categories: Record<string, number> = {};
  for (const row of rows) {
    categories[row.category] = (categories[row.category] || 0) + Number(row.amount);
  }
  return {
    ok: true,
    data: {
      income: Math.round(income * 100) / 100,
      expense: Math.round(expense * 100) / 100,
      balance: Math.round((income - expense) * 100) / 100,
      count: rows.length,
      categories,
    },
  };
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function exportCashbook(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!canRead(user)) return { ok: false, message: "无权限", code: 403 };
  const rows = scopedRows(db, user, payload);
  const header = [
    "流水号",
    "门店",
    "方向",
    "类别",
    "金额",
    "发生时间",
    "往来方",
    "方式",
    "成交单",
    "状态",
    "备注",
    "作废原因",
    "登记人",
  ];
  const content = `\uFEFF${[
    header.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.store_name,
        row.direction,
        row.category,
        row.amount,
        row.occurred_at,
        row.counterparty,
        row.payment_method,
        row.deal_id,
        row.status,
        row.note,
        row.void_reason,
        row.creator_name,
      ]
        .map(csvCell)
        .join(",")
    ),
  ].join("\r\n")}`;
  writeAudit(db, user, "cashbook.export", "cashbook_entry", undefined, {
    rows: rows.length,
  });
  return {
    ok: true,
    data: {
      filename: `收支流水-${todayDate()}.csv`,
      mime: "text/csv;charset=utf-8",
      content,
      rows: rows.length,
    },
  };
}
