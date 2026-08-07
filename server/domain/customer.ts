import type { Db } from "../db/database";
import { canWriteListing, customerVisibleTo, maskPhone } from "../auth/policy";
import { writeAudit } from "./audit";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function presentCustomer(user: SessionUser, row: any) {
  const canFull =
    user.role === "admin" ||
    user.role === "store_manager" ||
    user.id === row.agent_id;
  return {
    ...row,
    phone: canFull ? row.phone : maskPhone(row.phone),
    phone_masked: !canFull,
  };
}

export function listCustomers(db: Db, user: SessionUser, q: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(`SELECT * FROM customers WHERE company_id = ? ORDER BY updated_at DESC`)
    .all(user.company_id) as any[];
  rows = rows.filter((c) => customerVisibleTo(user, c));
  if (q.intent) rows = rows.filter((c) => c.intent === q.intent);
  if (q.level) rows = rows.filter((c) => c.level === q.level);
  if (q.visibility) rows = rows.filter((c) => c.visibility === q.visibility);
  if (q.status) rows = rows.filter((c) => c.status === q.status);
  if (q.agent_id) rows = rows.filter((c) => c.agent_id === q.agent_id);
  if (q.keyword) {
    const k = String(q.keyword);
    rows = rows.filter((c) => c.name.includes(k) || c.phone.includes(k) || (c.need || "").includes(k));
  }
  return { ok: true, data: rows.map((r) => presentCustomer(user, r)) };
}

export function getCustomer(db: Db, user: SessionUser, id: string): ApiResult {
  const row = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(id, user.company_id) as any;
  if (!row || !customerVisibleTo(user, row)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  return { ok: true, data: presentCustomer(user, row) };
}

export function createCustomer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  if (!payload.name || !payload.phone || !payload.intent) {
    return { ok: false, message: "姓名/电话/意图必填" };
  }
  if (!["buy", "rent"].includes(payload.intent)) {
    return { ok: false, message: "intent 无效" };
  }
  const dup = db
    .prepare(`SELECT id, name FROM customers WHERE company_id = ? AND phone = ?`)
    .get(user.company_id, payload.phone) as any;
  const id = nextId("C");
  const now = nowIso();
  db.prepare(
    `INSERT INTO customers(
      id, company_id, store_id, name, phone, intent, budget_min, budget_max, budget_note,
      need, level, visibility, status, agent_id, source, remark, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', 'new', ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    payload.name,
    payload.phone,
    payload.intent,
    payload.budget_min ?? null,
    payload.budget_max ?? null,
    payload.budget_note || null,
    payload.need || null,
    payload.level || "B",
    user.id,
    payload.source || null,
    payload.remark || null,
    now,
    now
  );
  writeAudit(db, user, "customer.create", "customer", id);
  const created = getCustomer(db, user, id);
  if (created.ok && dup) {
    return {
      ok: true,
      data: {
        ...(created.data as object),
        duplicate_hint: { id: dup.id, name: dup.name },
      },
    };
  }
  return created;
}

export function updateCustomer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current || !customerVisibleTo(user, current)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  if (user.role === "agent" && current.agent_id !== user.id && current.visibility !== "public") {
    return { ok: false, message: "只能编辑本人私客", code: 403 };
  }
  db.prepare(
    `UPDATE customers SET
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      intent = COALESCE(?, intent),
      budget_min = COALESCE(?, budget_min),
      budget_max = COALESCE(?, budget_max),
      budget_note = COALESCE(?, budget_note),
      need = COALESCE(?, need),
      level = COALESCE(?, level),
      source = COALESCE(?, source),
      remark = COALESCE(?, remark),
      updated_at = ?
     WHERE id = ?`
  ).run(
    payload.name ?? null,
    payload.phone ?? null,
    payload.intent ?? null,
    payload.budget_min ?? null,
    payload.budget_max ?? null,
    payload.budget_note ?? null,
    payload.need ?? null,
    payload.level ?? null,
    payload.source ?? null,
    payload.remark ?? null,
    nowIso(),
    payload.id
  );
  writeAudit(db, user, "customer.update", "customer", payload.id);
  return getCustomer(db, user, payload.id);
}

export function toPublic(
  db: Db,
  user: SessionUser,
  payload: { id: string; reason?: string }
): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current || !customerVisibleTo(user, current)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  if (user.role === "agent" && current.agent_id !== user.id) {
    return { ok: false, message: "只能转本人私客", code: 403 };
  }
  db.prepare(
    `UPDATE customers SET visibility = 'public', status = 'public_pool', remark = COALESCE(?, remark), updated_at = ? WHERE id = ?`
  ).run(payload.reason || current.remark, nowIso(), payload.id);
  writeAudit(db, user, "customer.to_public", "customer", payload.id, {
    reason: payload.reason,
  });
  return getCustomer(db, user, payload.id);
}

export function claimCustomer(db: Db, user: SessionUser, payload: { id: string }): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current) return { ok: false, message: "客源不存在" };
  if (current.store_id !== user.store_id && user.role !== "admin") {
    return { ok: false, message: "只能认领本店公客", code: 403 };
  }
  if (current.visibility !== "public") {
    return { ok: false, message: "仅公客可认领" };
  }
  db.prepare(
    `UPDATE customers SET visibility = 'private', agent_id = ?, store_id = ?, status = 'following', updated_at = ? WHERE id = ?`
  ).run(user.id, user.store_id, nowIso(), payload.id);
  writeAudit(db, user, "customer.claim", "customer", payload.id);
  return getCustomer(db, user, payload.id);
}
