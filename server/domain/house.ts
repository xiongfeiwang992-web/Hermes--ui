import type { Db } from "../db/database";
import {
  canSeeOwnerPhone,
  canWriteListing,
  houseVisibleTo,
  maskPhone,
} from "../auth/policy";
import { writeAudit } from "./audit";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const ALLOWED: Record<string, string[]> = {
  draft: ["available", "withdrawn"],
  available: ["suspended", "deal_pending", "withdrawn"],
  suspended: ["available", "withdrawn"],
  deal_pending: ["closed", "available", "withdrawn"],
  closed: [],
  withdrawn: [],
};

function presentHouse(user: SessionUser, row: any) {
  const visiblePhone = canSeeOwnerPhone(user, row)
    ? row.owner_phone
    : maskPhone(row.owner_phone);
  return {
    ...row,
    is_private: Boolean(row.is_private),
    owner_phone: visiblePhone,
    owner_phone_masked: !canSeeOwnerPhone(user, row),
  };
}

export function listHouses(db: Db, user: SessionUser, q: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT * FROM houses WHERE company_id = ? ORDER BY updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((h) => houseVisibleTo(user, h));
  if (q.deal_type) rows = rows.filter((h) => h.deal_type === q.deal_type);
  if (q.property_type) rows = rows.filter((h) => h.property_type === q.property_type);
  if (q.deal_mode) rows = rows.filter((h) => h.deal_mode === q.deal_mode);
  if (q.status) rows = rows.filter((h) => h.status === q.status);
  if (q.community)
    rows = rows.filter((h) =>
      String(h.community).includes(String(q.community))
    );
  if (q.agent_id) rows = rows.filter((h) => h.agent_id === q.agent_id);
  if (q.keyword) {
    const k = String(q.keyword);
    rows = rows.filter(
      (h) =>
        h.title.includes(k) ||
        h.community.includes(k) ||
        (h.address || "").includes(k)
    );
  }
  if (q.price_min != null) rows = rows.filter((h) => h.price >= Number(q.price_min));
  if (q.price_max != null) rows = rows.filter((h) => h.price <= Number(q.price_max));
  return { ok: true, data: rows.map((r) => presentHouse(user, r)) };
}

export function getHouse(db: Db, user: SessionUser, id: string): ApiResult {
  const row = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(id, user.company_id) as any;
  if (!row || !houseVisibleTo(user, row)) {
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  }
  return { ok: true, data: presentHouse(user, row) };
}

export function createHouse(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const required = ["title", "deal_type", "community", "price", "owner_name", "owner_phone"];
  for (const k of required) {
    if (payload[k] == null || payload[k] === "") {
      return { ok: false, message: `缺少字段：${k}` };
    }
  }
  if (!["sale", "rent"].includes(payload.deal_type)) {
    return { ok: false, message: "deal_type 无效" };
  }
  if (user.role === "agent") {
    const setting = db
      .prepare(`SELECT house_hold_limit FROM settings WHERE company_id = ?`)
      .get(user.company_id) as any;
    const held = db
      .prepare(
        `SELECT COUNT(*) AS c FROM houses WHERE company_id = ? AND agent_id = ?
         AND status NOT IN ('closed','withdrawn')`
      )
      .get(user.company_id, user.id) as any;
    if (Number(held?.c || 0) >= Number(setting?.house_hold_limit || 20)) {
      return { ok: false, message: "已达到个人持盘上限" };
    }
  }
  const duplicate = db
    .prepare(
      `SELECT id, title FROM houses
       WHERE company_id = ? AND status NOT IN ('closed','withdrawn')
       AND (
         owner_phone = ?
         OR (community = ? AND area_size IS NOT NULL AND ABS(area_size - ?) <= 5)
       )
       LIMIT 1`
    )
    .get(
      user.company_id,
      payload.owner_phone,
      payload.community,
      Number(payload.area_size || 0)
    ) as any;
  const id = nextId("H");
  const storeId = user.role === "admin" && payload.store_id ? payload.store_id : user.store_id;
  const agentId = payload.agent_id || user.id;
  const priceUnit = payload.deal_type === "sale" ? "wan" : "yuan_month";
  const now = nowIso();
  db.prepare(
    `INSERT INTO houses(
      id, company_id, store_id, title, deal_type, status, community, address, district,
      price, price_unit, area_size, rooms, floor, owner_name, owner_phone,
      listing_user_id, agent_id, is_private, source, remark, cover_image,
      property_type, deal_mode, visibility, is_locked, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    storeId,
    payload.title,
    payload.deal_type,
    payload.status || "draft",
    payload.community,
    payload.address || null,
    payload.district || null,
    Number(payload.price),
    priceUnit,
    payload.area_size ?? null,
    payload.rooms || null,
    payload.floor || null,
    payload.owner_name,
    payload.owner_phone,
    user.id,
    agentId,
    payload.is_private ? 1 : 0,
    payload.source || null,
    payload.remark || null,
    payload.cover_image || null,
    payload.property_type || "residential",
    payload.deal_mode || "normal",
    payload.visibility || "store",
    payload.is_locked ? 1 : 0,
    now,
    now
  );
  writeAudit(db, user, "house.create", "house", id, { title: payload.title });
  const created = getHouse(db, user, id);
  if (created.ok && duplicate) {
    return {
      ok: true,
      data: {
        ...(created.data as object),
        duplicate_hint: { id: duplicate.id, title: duplicate.title },
      },
    };
  }
  return created;
}

export function updateHouse(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current) return { ok: false, message: "房源不存在" };
  if (!houseVisibleTo(user, current)) return { ok: false, message: "无权限", code: 403 };
  if (user.role === "agent" && current.agent_id !== user.id) {
    return { ok: false, message: "只能编辑本人接盘房源", code: 403 };
  }
  db.prepare(
    `UPDATE houses SET
      title = COALESCE(?, title),
      community = COALESCE(?, community),
      address = COALESCE(?, address),
      district = COALESCE(?, district),
      price = COALESCE(?, price),
      area_size = COALESCE(?, area_size),
      rooms = COALESCE(?, rooms),
      floor = COALESCE(?, floor),
      owner_name = COALESCE(?, owner_name),
      owner_phone = COALESCE(?, owner_phone),
      is_private = COALESCE(?, is_private),
      source = COALESCE(?, source),
      remark = COALESCE(?, remark),
      cover_image = COALESCE(?, cover_image),
      property_type = COALESCE(?, property_type),
      deal_mode = COALESCE(?, deal_mode),
      visibility = COALESCE(?, visibility),
      is_locked = COALESCE(?, is_locked),
      updated_at = ?
     WHERE id = ?`
  ).run(
    payload.title ?? null,
    payload.community ?? null,
    payload.address ?? null,
    payload.district ?? null,
    payload.price != null ? Number(payload.price) : null,
    payload.area_size ?? null,
    payload.rooms ?? null,
    payload.floor ?? null,
    payload.owner_name ?? null,
    payload.owner_phone ?? null,
    payload.is_private == null ? null : payload.is_private ? 1 : 0,
    payload.source ?? null,
    payload.remark ?? null,
    payload.cover_image ?? null,
    payload.property_type ?? null,
    payload.deal_mode ?? null,
    payload.visibility ?? null,
    payload.is_locked == null ? null : payload.is_locked ? 1 : 0,
    nowIso(),
    payload.id
  );
  writeAudit(db, user, "house.update", "house", payload.id);
  return getHouse(db, user, payload.id);
}

export function changeHouseStatus(
  db: Db,
  user: SessionUser,
  payload: { id: string; status: string; reason?: string }
): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current || !houseVisibleTo(user, current)) {
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  }
  const allowed = ALLOWED[current.status] || [];
  if (!allowed.includes(payload.status)) {
    return { ok: false, message: `不能从 ${current.status} 变更为 ${payload.status}` };
  }
  if (payload.status === "withdrawn" && !payload.reason) {
    return { ok: false, message: "撤盘须填写原因" };
  }
  db.prepare(`UPDATE houses SET status = ?, remark = COALESCE(?, remark), updated_at = ? WHERE id = ?`).run(
    payload.status,
    payload.reason || null,
    nowIso(),
    payload.id
  );
  writeAudit(db, user, "house.status", "house", payload.id, {
    from: current.status,
    to: payload.status,
    reason: payload.reason,
  });
  return getHouse(db, user, payload.id);
}

export function changeHouseAgent(
  db: Db,
  user: SessionUser,
  payload: { id: string; agent_id: string }
): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  const current = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current) return { ok: false, message: "房源不存在" };
  if (user.role === "store_manager" && current.store_id !== user.store_id) {
    return { ok: false, message: "只能操作本店房源", code: 403 };
  }
  db.prepare(`UPDATE houses SET agent_id = ?, updated_at = ? WHERE id = ?`).run(
    payload.agent_id,
    nowIso(),
    payload.id
  );
  writeAudit(db, user, "house.agent", "house", payload.id, {
    from: current.agent_id,
    to: payload.agent_id,
  });
  return getHouse(db, user, payload.id);
}

export function setHouseLock(
  db: Db,
  user: SessionUser,
  payload: { id: string; locked: boolean }
): ApiResult {
  const house = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!house || !houseVisibleTo(user, house))
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  if (
    !(
      user.role === "admin" ||
      (user.role === "store_manager" && house.store_id === user.store_id) ||
      house.agent_id === user.id
    )
  )
    return { ok: false, message: "无权限", code: 403 };
  db.prepare(
    `UPDATE houses SET is_locked=?, locked_by=?, locked_at=?, updated_at=? WHERE id=?`
  ).run(
    payload.locked ? 1 : 0,
    payload.locked ? user.id : null,
    payload.locked ? nowIso() : null,
    nowIso(),
    house.id
  );
  writeAudit(db, user, payload.locked ? "house.lock" : "house.unlock", "house", house.id);
  return getHouse(db, user, house.id);
}
