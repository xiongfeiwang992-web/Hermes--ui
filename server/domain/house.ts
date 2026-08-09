import type { Db } from "../db/database";
import {
  canSeeOwnerPhone,
  canWriteListing,
  houseVisibleTo,
  maskPhone,
} from "../auth/policy";
import {
  buildModificationSummary,
  buildPriceChangeSummary,
  recordModificationFollow,
} from "./activity";
import { writeAudit } from "./audit";
import { resolvePhoneVisibility } from "./contactGate";
import { createMessage } from "./message";
import { setLock as setPropertyLock } from "./propertyExt";
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

const ROLE_TYPES = new Set([
  "surveyor",
  "verifier",
  "photographer",
  "floorplan",
  "key_keeper",
  "entrustment",
]);

function presentHouse(db: Db, user: SessionUser, row: any) {
  const policyAllows = canSeeOwnerPhone(user, row);
  const gate = resolvePhoneVisibility(db, user, policyAllows, "house", row.id);
  return {
    ...row,
    is_private: Boolean(row.is_private),
    owner_phone: gate.showFull ? row.owner_phone : maskPhone(row.owner_phone),
    owner_phone_masked: !gate.showFull,
    force_follow_required: gate.forceFollowRequired,
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
  return { ok: true, data: rows.map((r) => presentHouse(db, user, r)) };
}

export function getHouse(db: Db, user: SessionUser, id: string): ApiResult {
  const row = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(id, user.company_id) as any;
  if (!row || !houseVisibleTo(user, row)) {
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  }
  return { ok: true, data: presentHouse(db, user, row) };
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
  const areaSize =
    payload.area_size == null || payload.area_size === ""
      ? null
      : Number(payload.area_size);
  const duplicate =
    areaSize != null &&
    Number.isFinite(areaSize) &&
    String(payload.community || "").trim() &&
    String(payload.owner_phone || "").trim()
      ? (db
          .prepare(
            `SELECT id, title FROM houses
             WHERE company_id = ? AND status NOT IN ('closed','withdrawn')
             AND owner_phone = ?
             AND community = ?
             AND area_size IS NOT NULL
             AND ABS(area_size - ?) <= 5
             LIMIT 1`
          )
          .get(
            user.company_id,
            payload.owner_phone,
            payload.community,
            areaSize
          ) as any)
      : null;
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
  const nextPrice = payload.price != null ? Number(payload.price) : null;
  const nextPrivate = payload.is_private == null ? null : payload.is_private ? 1 : 0;
  const priceSummary =
    payload.price != null ? buildPriceChangeSummary(current.price, nextPrice) : null;
  const summary = buildModificationSummary([
    { label: "标题", provided: payload.title != null, prev: current.title, next: payload.title },
    {
      label: "小区",
      provided: payload.community != null,
      prev: current.community,
      next: payload.community,
    },
    { label: "地址", provided: payload.address != null, prev: current.address, next: payload.address },
    {
      label: "区域",
      provided: payload.district != null,
      prev: current.district,
      next: payload.district,
    },
    {
      label: "面积",
      provided: payload.area_size != null,
      prev: current.area_size,
      next: payload.area_size,
    },
    { label: "户型", provided: payload.rooms != null, prev: current.rooms, next: payload.rooms },
    { label: "楼层", provided: payload.floor != null, prev: current.floor, next: payload.floor },
    {
      label: "业主",
      provided: payload.owner_name != null,
      prev: current.owner_name,
      next: payload.owner_name,
    },
    {
      label: "业主电话",
      provided: payload.owner_phone != null,
      prev: current.owner_phone,
      next: payload.owner_phone,
      sensitive: true,
    },
    {
      label: "私盘",
      provided: payload.is_private != null,
      prev: current.is_private,
      next: nextPrivate,
      bool: true,
    },
    { label: "来源", provided: payload.source != null, prev: current.source, next: payload.source },
    { label: "备注", provided: payload.remark != null, prev: current.remark, next: payload.remark },
    {
      label: "封面",
      provided: payload.cover_image != null,
      prev: current.cover_image,
      next: payload.cover_image,
      sensitive: true,
    },
    {
      label: "物业类型",
      provided: payload.property_type != null,
      prev: current.property_type,
      next: payload.property_type,
    },
    {
      label: "交易模式",
      provided: payload.deal_mode != null,
      prev: current.deal_mode,
      next: payload.deal_mode,
    },
    {
      label: "可见范围",
      provided: payload.visibility != null,
      prev: current.visibility,
      next: payload.visibility,
    },
  ]);
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
      updated_at = ?
     WHERE id = ?`
  ).run(
    payload.title ?? null,
    payload.community ?? null,
    payload.address ?? null,
    payload.district ?? null,
    nextPrice,
    payload.area_size ?? null,
    payload.rooms ?? null,
    payload.floor ?? null,
    payload.owner_name ?? null,
    payload.owner_phone ?? null,
    nextPrivate,
    payload.source ?? null,
    payload.remark ?? null,
    payload.cover_image ?? null,
    payload.property_type ?? null,
    payload.deal_mode ?? null,
    payload.visibility ?? null,
    nowIso(),
    payload.id
  );
  writeAudit(db, user, "house.update", "house", payload.id);
  if (priceSummary) {
    recordModificationFollow(db, user, {
      targetType: "house",
      targetId: payload.id,
      summary: priceSummary,
      followKind: "price_change",
    });
  }
  if (summary) {
    recordModificationFollow(db, user, {
      targetType: "house",
      targetId: payload.id,
      summary,
    });
  }
  return getHouse(db, user, payload.id);
}

function resolveStoreAgent(
  db: Db,
  companyId: string,
  storeId: string,
  agentId: string
): { ok: true; agent: any } | { ok: false; message: string; code?: number } {
  const agent = db
    .prepare(
      `SELECT id, display_name, role, store_id, status FROM users
       WHERE id = ? AND company_id = ?`
    )
    .get(agentId, companyId) as any;
  if (!agent || agent.status !== "active") {
    return { ok: false, message: "接盘人不存在或已停用" };
  }
  if (agent.store_id !== storeId) {
    return { ok: false, message: "只能指定本店员工为接盘人" };
  }
  if (!["agent", "store_manager"].includes(agent.role)) {
    return { ok: false, message: "接盘人须为经纪人或店长" };
  }
  return { ok: true, agent };
}

export function changeHouseStatus(
  db: Db,
  user: SessionUser,
  payload: { id: string; status: string; reason?: string; agent_id?: string }
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
  let nextAgentId = current.agent_id;
  if (
    payload.agent_id &&
    payload.agent_id !== current.agent_id &&
    payload.status === "available" &&
    current.status === "suspended"
  ) {
    if (!(user.role === "admin" || user.role === "store_manager")) {
      return { ok: false, message: "仅店长/管理员恢复上架时可改接盘人", code: 403 };
    }
    const resolved = resolveStoreAgent(db, user.company_id, current.store_id, payload.agent_id);
    if (!resolved.ok) return resolved;
    nextAgentId = payload.agent_id;
  } else if (payload.agent_id && payload.agent_id !== current.agent_id) {
    return { ok: false, message: "仅暂缓恢复上架时可顺带改接盘人" };
  }
  const now = nowIso();
  db.prepare(
    `UPDATE houses SET status = ?, agent_id = ?, remark = COALESCE(?, remark), updated_at = ? WHERE id = ?`
  ).run(payload.status, nextAgentId, payload.reason || null, now, payload.id);
  writeAudit(db, user, "house.status", "house", payload.id, {
    from: current.status,
    to: payload.status,
    reason: payload.reason,
    agent_from: current.agent_id,
    agent_to: nextAgentId,
  });
  if (nextAgentId !== current.agent_id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: current.store_id,
      user_id: nextAgentId,
      title: "接盘房源已分配",
      body: `房源「${current.title}」已恢复上架并指定您为接盘人`,
      kind: "house_agent",
      ref_type: "house",
      ref_id: current.id,
    });
    if (current.agent_id) {
      createMessage(db, {
        company_id: user.company_id,
        store_id: current.store_id,
        user_id: current.agent_id,
        title: "接盘人已变更",
        body: `房源「${current.title}」恢复上架时接盘人已变更`,
        kind: "house_agent",
        ref_type: "house",
        ref_id: current.id,
      });
    }
  }
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
  if (["closed", "withdrawn"].includes(current.status)) {
    return { ok: false, message: "已成交或已撤盘房源不可改接盘人" };
  }
  if (!payload.agent_id) return { ok: false, message: "须指定接盘人" };
  if (payload.agent_id === current.agent_id) {
    return { ok: false, message: "接盘人未变化" };
  }
  const resolved = resolveStoreAgent(db, user.company_id, current.store_id, payload.agent_id);
  if (!resolved.ok) return resolved;
  db.prepare(`UPDATE houses SET agent_id = ?, updated_at = ? WHERE id = ?`).run(
    payload.agent_id,
    nowIso(),
    payload.id
  );
  writeAudit(db, user, "house.agent", "house", payload.id, {
    from: current.agent_id,
    to: payload.agent_id,
  });
  createMessage(db, {
    company_id: user.company_id,
    store_id: current.store_id,
    user_id: payload.agent_id,
    title: "接盘房源已分配",
    body: `房源「${current.title}」已指定您为接盘人`,
    kind: "house_agent",
    ref_type: "house",
    ref_id: current.id,
  });
  if (current.agent_id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: current.store_id,
      user_id: current.agent_id,
      title: "接盘人已变更",
      body: `房源「${current.title}」接盘人已变更给 ${resolved.agent.display_name}`,
      kind: "house_agent",
      ref_type: "house",
      ref_id: current.id,
    });
  }
  return getHouse(db, user, payload.id);
}

export function setHouseLock(
  db: Db,
  user: SessionUser,
  payload: { id: string; locked: boolean; reason?: string; lock_until?: string }
): ApiResult {
  const result = setPropertyLock(db, user, payload);
  if (!result.ok) return result;
  return getHouse(db, user, payload.id);
}

export function ensureHouseRole(
  db: Db,
  house: any,
  roleType: string,
  userId: string,
  createdBy: string,
  protectedUntil?: string | null
): string {
  const existing = db
    .prepare(
      `SELECT id FROM house_role_holders
       WHERE house_id=? AND role_type=? AND user_id=?`
    )
    .get(house.id, roleType, userId) as any;
  const id = existing?.id || nextId("HRH");
  db.prepare(
    `INSERT INTO house_role_holders(
       id, company_id, store_id, house_id, role_type, user_id,
       protected_until, created_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(house_id, role_type, user_id) DO UPDATE SET
       protected_until=excluded.protected_until`
  ).run(
    id,
    house.company_id,
    house.store_id,
    house.id,
    roleType,
    userId,
    protectedUntil || null,
    createdBy,
    nowIso()
  );
  return id;
}

export function roleAllowsOperation(
  db: Db,
  houseId: string,
  roleType: string,
  user: SessionUser
): boolean {
  if (user.role === "admin" || user.role === "store_manager") return true;
  const active = db
    .prepare(
      `SELECT user_id FROM house_role_holders
       WHERE house_id=? AND role_type=?
       AND (protected_until IS NULL OR protected_until >= ?)`
    )
    .all(houseId, roleType, nowIso()) as any[];
  return active.length === 0 || active.some((row) => row.user_id === user.id);
}

export function listHouseRoles(db: Db, user: SessionUser, payload: any): ApiResult {
  const house = db
    .prepare(`SELECT * FROM houses WHERE id=? AND company_id=?`)
    .get(payload.house_id, user.company_id) as any;
  if (!house || !houseVisibleTo(user, house))
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  const rows = db
    .prepare(
      `SELECT r.*, u.display_name
       FROM house_role_holders r JOIN users u ON u.id=r.user_id
       WHERE r.house_id=? ORDER BY r.role_type, r.created_at`
    )
    .all(house.id);
  return { ok: true, data: rows };
}

export function assignHouseRole(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  if (!ROLE_TYPES.has(payload.role_type))
    return { ok: false, message: "房源角色类型无效" };
  const house = db
    .prepare(`SELECT * FROM houses WHERE id=? AND company_id=?`)
    .get(payload.house_id, user.company_id) as any;
  if (
    !house ||
    (user.role === "store_manager" && house.store_id !== user.store_id)
  )
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  const holder = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.user_id, user.company_id) as any;
  if (!holder || holder.store_id !== house.store_id)
    return { ok: false, message: "角色人须为房源同店在职员工" };
  const protectedDate = payload.protected_until
    ? new Date(payload.protected_until)
    : null;
  if (protectedDate && Number.isNaN(protectedDate.getTime()))
    return { ok: false, message: "保护期日期无效" };
  const protectedUntil = protectedDate ? protectedDate.toISOString() : null;
  const id = ensureHouseRole(
    db,
    house,
    payload.role_type,
    holder.id,
    user.id,
    protectedUntil
  );
  createMessage(db, {
    company_id: user.company_id,
    store_id: house.store_id,
    user_id: holder.id,
    title: "房源角色已指派",
    body: `${house.title}：${payload.role_type}${protectedUntil ? `，保护至 ${protectedUntil.slice(0, 10)}` : ""}`,
    kind: "house_role",
    ref_type: "house",
    ref_id: house.id,
  });
  writeAudit(db, user, "house.role.assign", "house_role_holder", id, {
    house_id: house.id,
    role_type: payload.role_type,
    user_id: holder.id,
    protected_until: protectedUntil,
  });
  return { ok: true, data: { id } };
}

export function removeHouseRole(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  const role = db
    .prepare(`SELECT * FROM house_role_holders WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (
    !role ||
    (user.role === "store_manager" && role.store_id !== user.store_id)
  )
    return { ok: false, message: "角色记录不存在或无权限", code: 403 };
  const protectedNow = role.protected_until && role.protected_until >= nowIso();
  if (protectedNow && user.role !== "admin")
    return { ok: false, message: "角色保护期内仅管理员可解除" };
  if (protectedNow && !String(payload.reason || "").trim())
    return { ok: false, message: "保护期内解除须填写原因" };
  db.prepare(`DELETE FROM house_role_holders WHERE id=?`).run(role.id);
  writeAudit(db, user, "house.role.remove", "house_role_holder", role.id, {
    house_id: role.house_id,
    role_type: role.role_type,
    reason: payload.reason,
  });
  return { ok: true, data: { id: role.id } };
}

export function listRelatedByOwner(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const houseId = payload.id || payload.house_id;
  if (!houseId) return { ok: false, message: "缺少房源 id" };
  const current = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(houseId, user.company_id) as any;
  if (!current || !houseVisibleTo(user, current)) {
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  }
  const rows = db
    .prepare(
      `SELECT * FROM houses
       WHERE company_id = ? AND owner_phone = ? AND id != ?
       ORDER BY updated_at DESC`
    )
    .all(user.company_id, current.owner_phone, current.id) as any[];
  const related = rows
    .filter((row) => houseVisibleTo(user, row))
    .map((row) => presentHouse(db, user, row));
  return {
    ok: true,
    data: {
      house_id: current.id,
      owner_name: current.owner_name,
      owner_phone: canSeeOwnerPhone(user, current)
        ? current.owner_phone
        : maskPhone(current.owner_phone),
      related_count: related.length,
      items: related,
    },
  };
}
