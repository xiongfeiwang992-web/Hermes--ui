import type { Db } from "../db/database";
import { houseVisibleTo } from "../auth/policy";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { ensureHouseRole, roleAllowsOperation } from "./house";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const TYPES = new Set(["general", "exclusive", "rental_management"]);

function refreshExpired(db: Db, houseId: string): void {
  const now = nowIso();
  db.prepare(
    `UPDATE house_entrustments SET status='expired', updated_at=?
     WHERE house_id=? AND status='active' AND end_at<?`
  ).run(now, houseId, now);
}

function getVisibleHouse(db: Db, user: SessionUser, houseId: string): any | null {
  const house = db
    .prepare(`SELECT * FROM houses WHERE id=? AND company_id=?`)
    .get(houseId, user.company_id) as any;
  return house && houseVisibleTo(user, house) ? house : null;
}

export function listEntrustments(db: Db, user: SessionUser, payload: any): ApiResult {
  const house = getVisibleHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  refreshExpired(db, house.id);
  const rows = db
    .prepare(
      `SELECT e.*, a.name AS attachment_name, u.display_name AS created_by_name
       FROM house_entrustments e
       LEFT JOIN file_attachments a ON a.id=e.attachment_id
       JOIN users u ON u.id=e.created_by
       WHERE e.house_id=? ORDER BY e.created_at DESC`
    )
    .all(house.id);
  return { ok: true, data: rows };
}

export function registerEntrustment(db: Db, user: SessionUser, payload: any): ApiResult {
  const house = getVisibleHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  if (user.role === "finance" || (user.role === "agent" && house.agent_id !== user.id))
    return { ok: false, message: "无委托登记权限", code: 403 };
  if (["closed", "withdrawn"].includes(house.status))
    return { ok: false, message: "已成交或撤盘房源不可登记委托" };
  if (!TYPES.has(payload.entrust_type))
    return { ok: false, message: "委托类型无效" };
  if (payload.entrust_type === "rental_management" && house.deal_type !== "rent")
    return { ok: false, message: "租赁托管委托仅适用于租盘" };
  const start = new Date(payload.start_at);
  const end = new Date(payload.end_at);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end.getTime() <= start.getTime()
  )
    return { ok: false, message: "委托起止日期无效" };
  const signed = payload.signed_at ? new Date(payload.signed_at) : null;
  if (signed && Number.isNaN(signed.getTime()))
    return { ok: false, message: "签署日期无效" };
  refreshExpired(db, house.id);
  const active = db
    .prepare(`SELECT id FROM house_entrustments WHERE house_id=? AND status='active'`)
    .get(house.id);
  if (active) return { ok: false, message: "该房源已有生效中的委托" };
  const id = nextId("ENT");
  const now = nowIso();
  db.prepare(
    `INSERT INTO house_entrustments(
       id, company_id, store_id, house_id, entrust_type, status,
       start_at, end_at, signed_at, remark, created_by, updated_by,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    house.store_id,
    house.id,
    payload.entrust_type,
    start.toISOString(),
    end.toISOString(),
    signed ? signed.toISOString() : null,
    payload.remark || null,
    user.id,
    user.id,
    now,
    now
  );
  ensureHouseRole(db, house, "entrustment", user.id, user.id, end.toISOString());
  writeAudit(db, user, "entrustment.register", "house_entrustment", id, {
    house_id: house.id,
    entrust_type: payload.entrust_type,
    end_at: end.toISOString(),
  });
  return { ok: true, data: { id } };
}

export function renewEntrustment(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(
      `SELECT e.*, h.agent_id, h.title, h.company_id AS house_company_id
       FROM house_entrustments e JOIN houses h ON h.id=e.house_id
       WHERE e.id=? AND e.company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (!row || !roleAllowsOperation(db, row.house_id, "entrustment", user))
    return { ok: false, message: "委托不存在或处于他人保护期", code: 403 };
  if (user.role === "finance" || (user.role === "agent" && row.agent_id !== user.id))
    return { ok: false, message: "无委托续期权限", code: 403 };
  if (!["active", "expired"].includes(row.status))
    return { ok: false, message: "当前委托状态不可续期" };
  const end = new Date(payload.end_at);
  if (Number.isNaN(end.getTime()) || end.toISOString() <= row.end_at)
    return { ok: false, message: "续期日期须晚于原到期日" };
  const now = nowIso();
  db.prepare(
    `UPDATE house_entrustments SET status='active', end_at=?, updated_by=?, updated_at=?
     WHERE id=?`
  ).run(end.toISOString(), user.id, now, row.id);
  const house = db.prepare(`SELECT * FROM houses WHERE id=?`).get(row.house_id) as any;
  ensureHouseRole(db, house, "entrustment", row.created_by, user.id, end.toISOString());
  writeAudit(db, user, "entrustment.renew", "house_entrustment", row.id, {
    end_at: end.toISOString(),
  });
  return { ok: true, data: { id: row.id, end_at: end.toISOString() } };
}

export function terminateEntrustment(db: Db, user: SessionUser, payload: any): ApiResult {
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "终止原因必填" };
  const row = db
    .prepare(
      `SELECT e.*, h.agent_id, h.title
       FROM house_entrustments e JOIN houses h ON h.id=e.house_id
       WHERE e.id=? AND e.company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (!row || !roleAllowsOperation(db, row.house_id, "entrustment", user))
    return { ok: false, message: "委托不存在或处于他人保护期", code: 403 };
  if (user.role === "finance" || (user.role === "agent" && row.agent_id !== user.id))
    return { ok: false, message: "无委托终止权限", code: 403 };
  if (row.status !== "active") return { ok: false, message: "仅生效委托可终止" };
  const now = nowIso();
  db.prepare(
    `UPDATE house_entrustments SET status='terminated', terminated_at=?,
     terminate_reason=?, updated_by=?, updated_at=? WHERE id=?`
  ).run(now, reason, user.id, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.created_by,
    title: "业主委托已终止",
    body: `${row.title}：${reason}`,
    kind: "entrustment_terminated",
    ref_type: "house",
    ref_id: row.house_id,
  });
  writeAudit(db, user, "entrustment.terminate", "house_entrustment", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id } };
}

export function linkEntrustmentAttachment(
  db: Db,
  houseId: string,
  attachmentId: string
): boolean {
  refreshExpired(db, houseId);
  const row = db
    .prepare(
      `SELECT id FROM house_entrustments
       WHERE house_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`
    )
    .get(houseId) as any;
  if (!row) return false;
  db.prepare(
    `UPDATE house_entrustments SET attachment_id=?, updated_at=? WHERE id=?`
  ).run(attachmentId, nowIso(), row.id);
  return true;
}
