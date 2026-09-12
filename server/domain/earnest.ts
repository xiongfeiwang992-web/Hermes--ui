import type { Db } from "../db/database";
import { canRegisterPayment, canWriteListing, customerVisibleTo, houseVisibleTo } from "../auth/policy";
import { writeAudit } from "./audit";
import {
  isAllowedPaymentMethod,
  labelPaymentMethod,
  normalizePaymentMethod,
} from "./config";
import { createMessage } from "./message";
import { nextId, nowIso, todayDate } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function visibleTo(user: SessionUser, row: { store_id: string; created_by: string }): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  if (user.store_id !== row.store_id) return false;
  if (user.role === "store_manager") return true;
  return user.id === row.created_by;
}

export function listEarnest(db: Db, user: SessionUser, query: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT e.*, c.name AS customer_name, h.title AS house_title
       FROM earnest_moneys e
       JOIN customers c ON c.id = e.customer_id
       JOIN houses h ON h.id = e.house_id
       WHERE e.company_id = ?
       ORDER BY e.paid_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visibleTo(user, row));
  if (query.status) rows = rows.filter((row) => row.status === query.status);
  if (query.customer_id) rows = rows.filter((row) => row.customer_id === query.customer_id);
  if (query.house_id) rows = rows.filter((row) => row.house_id === query.house_id);
  if (query.deal_id) rows = rows.filter((row) => row.deal_id === query.deal_id);
  if (query.method) {
    const method = normalizePaymentMethod(query.method);
    rows = rows.filter((row) => normalizePaymentMethod(row.method) === method);
  }
  if (query.keyword) {
    const k = String(query.keyword).trim().toLowerCase();
    rows = rows.filter(
      (row) =>
        String(row.id).toLowerCase().includes(k) ||
        String(row.customer_name || "").toLowerCase().includes(k) ||
        String(row.house_title || "").toLowerCase().includes(k) ||
        String(row.deal_id || "").toLowerCase().includes(k) ||
        String(row.remark || "").toLowerCase().includes(k) ||
        String(row.refund_reason || "").toLowerCase().includes(k)
    );
  }
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      method_label: labelPaymentMethod(db, user.company_id, row.method),
    })),
  };
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function exportEarnest(db: Db, user: SessionUser, query: any = {}): ApiResult {
  const listed = listEarnest(db, user, query);
  if (!listed.ok) return listed;
  const rows = listed.data as any[];
  const statusLabel: Record<string, string> = {
    held: "在管",
    applied: "已冲抵",
    refunded: "已退款",
  };
  const header = [
    "意向金编号",
    "门店",
    "状态",
    "金额",
    "方式",
    "客户",
    "房源",
    "成交单",
    "收款时间",
    "冲抵时间",
    "退款时间",
    "备注",
    "退款原因",
  ];
  const content = `\uFEFF${[
    header.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.store_id,
        statusLabel[row.status] || row.status,
        row.amount,
        row.method_label || row.method,
        row.customer_name,
        row.house_title,
        row.deal_id || "",
        row.paid_at,
        row.applied_at || "",
        row.refunded_at || "",
        row.remark || "",
        row.refund_reason || "",
      ]
        .map(csvCell)
        .join(",")
    ),
  ].join("\r\n")}`;
  writeAudit(db, user, "earnest.export", "earnest_money", undefined, {
    rows: rows.length,
    status: query.status || null,
    method: query.method || null,
    keyword: query.keyword || null,
  });
  return {
    ok: true,
    data: {
      filename: `意向金列表-${todayDate()}.csv`,
      mime: "text/csv;charset=utf-8",
      content,
      rows: rows.length,
    },
  };
}

export function createEarnest(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const amount = Number(payload.amount);
  if (!(amount > 0)) return { ok: false, message: "意向金金额须大于 0" };
  const method = normalizePaymentMethod(payload.method);
  if (!isAllowedPaymentMethod(db, user.company_id, method)) {
    return { ok: false, message: "收款方式不在当前字典中" };
  }
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.customer_id, user.company_id) as any;
  const house = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.house_id, user.company_id) as any;
  if (!customer || !customerVisibleTo(user, customer)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  if (!house || !houseVisibleTo(user, house)) {
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  }
  if (customer.store_id !== house.store_id) {
    return { ok: false, message: "意向金房客须归属同一门店" };
  }
  const id = nextId("EM");
  const now = nowIso();
  db.prepare(
    `INSERT INTO earnest_moneys(
      id, company_id, store_id, customer_id, house_id, amount, paid_at,
      method, status, remark, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'held', ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    house.store_id,
    customer.id,
    house.id,
    amount,
    payload.paid_at || now,
    method,
    payload.remark || null,
    user.id,
    now,
    now
  );
  writeAudit(db, user, "earnest.create", "earnest_money", id, { amount });
  return { ok: true, data: { id } };
}

export function applyEarnest(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canRegisterPayment(user)) return { ok: false, message: "无权限", code: 403 };
  const earnest = db
    .prepare(`SELECT * FROM earnest_moneys WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!earnest) return { ok: false, message: "意向金不存在" };
  if (earnest.status !== "held") return { ok: false, message: "意向金当前不可冲抵" };
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(payload.deal_id, user.company_id) as any;
  if (!deal || deal.status !== "approved") {
    return { ok: false, message: "仅可冲抵已审批成交单" };
  }
  if (deal.customer_id !== earnest.customer_id || deal.house_id !== earnest.house_id) {
    return { ok: false, message: "意向金与成交单房客不一致" };
  }
  const now = nowIso();
  const paymentId = nextId("PAY");
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO payments(
        id, company_id, store_id, deal_id, amount, pay_type, method, paid_at,
        payer_side, status, remark, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, 'earnest_apply', ?, ?, 'customer', 'confirmed', ?, ?, ?)`
    ).run(
      paymentId,
      user.company_id,
      deal.store_id,
      deal.id,
      earnest.amount,
      earnest.method,
      now,
      `意向金 ${earnest.id} 冲抵`,
      user.id,
      now
    );
    db.prepare(
      `UPDATE earnest_moneys SET status = 'applied', deal_id = ?, applied_at = ?,
       updated_at = ? WHERE id = ?`
    ).run(deal.id, now, now, earnest.id);
  });
  tx();
  writeAudit(db, user, "earnest.apply", "earnest_money", earnest.id, {
    deal_id: deal.id,
    amount: earnest.amount,
  });
  createMessage(db, {
    company_id: user.company_id,
    store_id: deal.store_id,
    user_id: earnest.created_by,
    title: "意向金已冲抵",
    body: `意向金 ¥${earnest.amount} 已冲抵成交单 ${deal.id}`,
    kind: "earnest_apply",
    ref_type: "deal",
    ref_id: deal.id,
  });
  return { ok: true, data: { id: earnest.id, payment_id: paymentId } };
}

export function refundEarnest(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "finance")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "退款原因必填" };
  const earnest = db
    .prepare(`SELECT * FROM earnest_moneys WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!earnest) return { ok: false, message: "意向金不存在" };
  if (earnest.status !== "held") return { ok: false, message: "意向金当前不可退款" };
  const now = nowIso();
  db.prepare(
    `UPDATE earnest_moneys SET status = 'refunded', refunded_at = ?,
     refund_reason = ?, updated_at = ? WHERE id = ?`
  ).run(now, reason, now, earnest.id);
  writeAudit(db, user, "earnest.refund", "earnest_money", earnest.id, {
    reason,
    amount: earnest.amount,
  });
  createMessage(db, {
    company_id: user.company_id,
    store_id: earnest.store_id,
    user_id: earnest.created_by,
    title: "意向金已退款",
    body: `意向金 ¥${earnest.amount} 已退款：${reason}`,
    kind: "earnest_refund",
    ref_type: "earnest_money",
    ref_id: earnest.id,
  });
  return { ok: true, data: { id: earnest.id } };
}
