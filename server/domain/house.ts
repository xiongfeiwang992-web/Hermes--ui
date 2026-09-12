import type { Db } from "../db/database";

import {
  canSeeOwnerPhone,
  canWriteListing,
  formatMaskedPhone,
  houseVisibleTo,
} from "../auth/policy";

import {
  buildModificationSummary,
  buildPriceChangeSummary,
  recordModificationFollow,
} from "./activity";

import { writeAudit } from "./audit";

import { isAllowedDealMode, labelDealMode, normalizeDealMode, holdLimitForDealType, isAllowedHouseSource, labelHouseSource, normalizeHouseSource, isAllowedPropertyType, labelPropertyType, normalizePropertyType, isAllowedHouseSuspendReason, labelHouseSuspendReason, normalizeHouseSuspendReason, isAllowedHouseWithdrawReason, labelHouseWithdrawReason, normalizeHouseWithdrawReason } from "./config";

import { isBlacklistedPhone } from "./blacklist";

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

const HOUSE_ORIENTATIONS = new Set([
  "east",
  "south",
  "west",
  "north",
  "south_north",
  "east_west",
  "southeast",
  "southwest",
  "northeast",
  "northwest",
]);

const HOUSE_DECORATIONS = new Set([
  "blank",
  "simple",
  "medium",
  "fine",
  "luxury",
  "other",
]);

const ORIENTATION_LABELS: Record<string, string> = {
  east: "东",
  south: "南",
  west: "西",
  north: "北",
  south_north: "南北",
  east_west: "东西",
  southeast: "东南",
  southwest: "西南",
  northeast: "东北",
  northwest: "西北",
};

const DECORATION_LABELS: Record<string, string> = {
  blank: "毛坯",
  simple: "简装",
  medium: "中装",
  fine: "精装",
  luxury: "豪装",
  other: "其他",
};

function normalizeOptionalEnum(
  value: unknown,
  allowed: Set<string>
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value == null || value === "") return { ok: true, value: null };
  const raw = String(value).trim();
  if (!allowed.has(raw)) return { ok: false, message: "枚举值无效" };
  return { ok: true, value: raw };
}

function presentHouse(db: Db, user: SessionUser, row: any) {
  const policyAllows = canSeeOwnerPhone(user, row);
  const gate = resolvePhoneVisibility(db, user, policyAllows, "house", row.id);
  return {
    ...row,
    is_private: Boolean(row.is_private),
    owner_phone: gate.showFull ? row.owner_phone : formatMaskedPhone(row.owner_phone),
    owner_phone_masked: !gate.showFull,
    force_follow_required: gate.forceFollowRequired,
    deal_mode_label: labelDealMode(db, user.company_id, row.deal_mode),
    source_label: labelHouseSource(db, user.company_id, row.source),
    property_type_label: labelPropertyType(db, user.company_id, row.property_type),
    orientation_label: row.orientation
      ? ORIENTATION_LABELS[row.orientation] || row.orientation
      : "",
    decoration_label: row.decoration
      ? DECORATION_LABELS[row.decoration] || row.decoration
      : "",
    suspend_reason_label: labelHouseSuspendReason(
      db,
      user.company_id,
      row.suspend_reason
    ),
    withdraw_reason_label: labelHouseWithdrawReason(
      db,
      user.company_id,
      row.withdraw_reason
    ),
  };
}

function agentHoldExceeded(
  db: Db,
  companyId: string,
  agentId: string,
  dealType: string
): { exceeded: boolean; limit: number; held: number } {
  const limit = holdLimitForDealType(db, companyId, dealType);
  const held = db
    .prepare(
      `SELECT COUNT(*) AS c FROM houses
       WHERE company_id = ? AND agent_id = ? AND deal_type = ?
         AND status NOT IN ('closed','withdrawn')`
    )
    .get(companyId, agentId, dealType) as { c: number };
  const count = Number(held?.c || 0);
  return { exceeded: count >= limit, limit, held: count };
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
  if (q.orientation) rows = rows.filter((h) => h.orientation === q.orientation);
  if (q.decoration) rows = rows.filter((h) => h.decoration === q.decoration);
  if (q.status) rows = rows.filter((h) => h.status === q.status);
  if (q.community)
    rows = rows.filter((h) =>
      String(h.community).includes(String(q.community))
    );
  if (q.agent_id) rows = rows.filter((h) => h.agent_id === q.agent_id);
  if (q.source) {
    const source = normalizeHouseSource(q.source);
    rows = rows.filter((h) => normalizeHouseSource(h.source) === source);
  }
  if (q.keyword) {
    const k = String(q.keyword);
    rows = rows.filter(
      (h) =>
        h.title.includes(k) ||
        h.community.includes(k) ||
        (h.address || "").includes(k)
    );
  }
  if (q.price_min != null && q.price_min !== "") rows = rows.filter((h) => h.price >= Number(q.price_min));
  if (q.price_max != null && q.price_max !== "") rows = rows.filter((h) => h.price <= Number(q.price_max));
  if (q.pool === "private") rows = rows.filter((h) => Boolean(h.is_private));
  if (q.pool === "public") rows = rows.filter((h) => !Boolean(h.is_private));
  if (q.is_locked === "1" || q.is_locked === 1 || q.is_locked === true)
    rows = rows.filter((h) => Boolean(h.is_locked));
  if (q.is_locked === "0" || q.is_locked === 0 || q.is_locked === false)
    rows = rows.filter((h) => !Boolean(h.is_locked));

  const coopMode = String(q.cooperation || "").trim();
  if (coopMode) {
    const activeCoops = db
      .prepare(
        `SELECT house_id, partner_user_id, created_by FROM house_cooperations
         WHERE company_id = ? AND status = 'active'`
      )
      .all(user.company_id) as Array<{
      house_id: string;
      partner_user_id: string | null;
      created_by: string;
    }>;
    const coopHouseIds = new Set(activeCoops.map((row) => row.house_id));
    const partnerHouseIds = new Set(
      activeCoops
        .filter((row) => row.partner_user_id === user.id)
        .map((row) => row.house_id)
    );
    const storePartnerHouseIds = new Set(
      activeCoops
        .filter((row) => {
          if (!row.partner_user_id) return false;
          if (user.role === "admin") return true;
          const partner = db
            .prepare(`SELECT store_id FROM users WHERE id = ?`)
            .get(row.partner_user_id) as any;
          return partner && partner.store_id === user.store_id;
        })
        .map((row) => row.house_id)
    );
    if (coopMode === "active") {
      rows = rows.filter((h) => coopHouseIds.has(h.id));
    } else if (coopMode === "owner") {
      // 合作：我是接盘人（店长/管理员看本店有合作的盘）
      rows = rows.filter((h) => {
        if (!coopHouseIds.has(h.id)) return false;
        if (user.role === "agent") return h.agent_id === user.id;
        return true;
      });
    } else if (coopMode === "partner") {
      // 被合作：我是合作方（店长/管理员看本店员工作为合作方的盘）
      rows = rows.filter((h) =>
        user.role === "agent" ? partnerHouseIds.has(h.id) : storePartnerHouseIds.has(h.id)
      );
    } else {
      return { ok: false, message: "合作筛选无效" };
    }
  }

  const presented = rows.map((r) => {
    const house = presentHouse(db, user, r);
    const coopCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM house_cooperations
           WHERE house_id = ? AND status = 'active'`
        )
        .get(r.id) as { c: number }
    ).c;
    const asPartner = Boolean(
      db
        .prepare(
          `SELECT id FROM house_cooperations
           WHERE house_id = ? AND status = 'active' AND partner_user_id = ?`
        )
        .get(r.id, user.id)
    );
    return {
      ...house,
      active_cooperation_count: coopCount,
      cooperation_as_owner: coopCount > 0 && r.agent_id === user.id,
      cooperation_as_partner: asPartner,
    };
  });
  if (q.page != null && q.page !== "") {
    const pageSize = Math.min(Math.max(Number(q.page_size) || 20, 1), 100);
    const page = Math.max(Number(q.page) || 1, 1);
    const total = presented.length;
    const start = (page - 1) * pageSize;
    return {
      ok: true,
      data: {
        items: presented.slice(start, start + pageSize),
        total,
        page,
        page_size: pageSize,
      },
    };
  }
  return { ok: true, data: presented };
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
  const dealMode = normalizeDealMode(payload.deal_mode);
  if (!isAllowedDealMode(db, user.company_id, dealMode)) {
    return { ok: false, message: "交易模式不在当前字典中" };
  }
  const source = normalizeHouseSource(payload.source);
  if (source && !isAllowedHouseSource(db, user.company_id, source)) {
    return { ok: false, message: "房源来源不在当前字典中" };
  }
  const propertyType = normalizePropertyType(payload.property_type);
  if (!isAllowedPropertyType(db, user.company_id, propertyType)) {
    return { ok: false, message: "物业类型不在当前字典中" };
  }
  if (isBlacklistedPhone(db, user.company_id, payload.owner_phone)) {
    return { ok: false, message: "该电话已在业务黑名单中" };
  }
  const orientationNorm = normalizeOptionalEnum(payload.orientation, HOUSE_ORIENTATIONS);
  if (!orientationNorm.ok) return { ok: false, message: "朝向不在可选范围内" };
  const decorationNorm = normalizeOptionalEnum(payload.decoration, HOUSE_DECORATIONS);
  if (!decorationNorm.ok) return { ok: false, message: "装修不在可选范围内" };
  if (user.role === "agent") {
    const hold = agentHoldExceeded(db, user.company_id, user.id, payload.deal_type);
    if (hold.exceeded) {
      return {
        ok: false,
        message:
          payload.deal_type === "sale"
            ? `已达到出售个人持盘上限（${hold.limit}）`
            : `已达到出租个人持盘上限（${hold.limit}）`,
      };
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
      property_type, deal_mode, visibility, is_locked, orientation, decoration,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    source,
    payload.remark || null,
    payload.cover_image || null,
    propertyType,
    dealMode,
    payload.visibility || "store",
    payload.is_locked ? 1 : 0,
    orientationNorm.value,
    decorationNorm.value,
    now,
    now
  );
  writeAudit(db, user, "house.create", "house", id, { title: payload.title });
  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND status='active'
       AND (role='admin' OR (role='store_manager' AND store_id=?))`
    )
    .all(user.company_id, user.store_id) as any[];
  for (const manager of managers) {
    if (manager.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: user.store_id,
      user_id: manager.id,
      title: "新房源已登记",
      body: `${payload.title} · ${user.display_name}`,
      kind: "house_agent",
      ref_type: "house",
      ref_id: id,
    });
  }
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
  if (
    payload.owner_phone != null &&
    String(payload.owner_phone).trim() !== String(current.owner_phone || "").trim() &&
    isBlacklistedPhone(db, user.company_id, payload.owner_phone)
  ) {
    return { ok: false, message: "该电话已在业务黑名单中" };
  }
  const nextPrice = payload.price != null ? Number(payload.price) : null;
  const orientationUpd = normalizeOptionalEnum(payload.orientation, HOUSE_ORIENTATIONS);
  if (!orientationUpd.ok) return { ok: false, message: "朝向不在可选范围内" };
  const decorationUpd = normalizeOptionalEnum(payload.decoration, HOUSE_DECORATIONS);
  if (!decorationUpd.ok) return { ok: false, message: "装修不在可选范围内" };
  const nextPrivate = payload.is_private == null ? null : payload.is_private ? 1 : 0;
  const dealModeProvided = Object.prototype.hasOwnProperty.call(payload, "deal_mode");
  const nextDealMode = dealModeProvided ? normalizeDealMode(payload.deal_mode) : null;
  if (dealModeProvided && nextDealMode && !isAllowedDealMode(db, user.company_id, nextDealMode)) {
    return { ok: false, message: "交易模式不在当前字典中" };
  }
  const sourceProvided = Object.prototype.hasOwnProperty.call(payload, "source");
  const nextSource = sourceProvided ? normalizeHouseSource(payload.source) : null;
  if (sourceProvided && nextSource && !isAllowedHouseSource(db, user.company_id, nextSource)) {
    return { ok: false, message: "房源来源不在当前字典中" };
  }
  const propertyTypeProvided = Object.prototype.hasOwnProperty.call(payload, "property_type");
  const nextPropertyType = propertyTypeProvided
    ? normalizePropertyType(payload.property_type)
    : null;
  if (
    propertyTypeProvided &&
    nextPropertyType &&
    !isAllowedPropertyType(db, user.company_id, nextPropertyType)
  ) {
    return { ok: false, message: "物业类型不在当前字典中" };
  }
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
    {
      label: "来源",
      provided: sourceProvided,
      prev: current.source,
      next: nextSource,
    },
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
      provided: propertyTypeProvided,
      prev: current.property_type,
      next: nextPropertyType,
    },
    {
      label: "交易模式",
      provided: dealModeProvided,
      prev: current.deal_mode,
      next: nextDealMode,
    },
    {
      label: "朝向",
      provided: payload.orientation != null,
      prev: current.orientation,
      next: orientationUpd.value,
    },
    {
      label: "装修",
      provided: payload.decoration != null,
      prev: current.decoration,
      next: decorationUpd.value,
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
      orientation = CASE WHEN ? THEN ? ELSE orientation END,
      decoration = CASE WHEN ? THEN ? ELSE decoration END,
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
    sourceProvided ? nextSource : null,
    payload.remark ?? null,
    payload.cover_image ?? null,
    propertyTypeProvided ? nextPropertyType : null,
    dealModeProvided ? nextDealMode : null,
    payload.visibility ?? null,
    payload.orientation != null ? 1 : 0,
    orientationUpd.value,
    payload.decoration != null ? 1 : 0,
    decorationUpd.value,
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
  let suspendReason: string | null = current.suspend_reason || null;
  if (payload.status === "suspended") {
    const reason = normalizeHouseSuspendReason(payload.reason, "");
    if (!reason) return { ok: false, message: "暂缓须填写原因" };
    if (!isAllowedHouseSuspendReason(db, user.company_id, reason)) {
      return { ok: false, message: "暂缓原因不在当前字典中" };
    }
    suspendReason = reason;
  }
  let withdrawReason: string | null = current.withdraw_reason || null;
  if (payload.status === "withdrawn") {
    const reason = normalizeHouseWithdrawReason(payload.reason, "");
    if (!reason) return { ok: false, message: "撤盘须填写原因" };
    if (!isAllowedHouseWithdrawReason(db, user.company_id, reason)) {
      return { ok: false, message: "撤盘原因不在当前字典中" };
    }
    withdrawReason = reason;
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
    if (resolved.agent.role === "agent") {
      const hold = agentHoldExceeded(
        db,
        user.company_id,
        payload.agent_id,
        current.deal_type
      );
      if (hold.exceeded) {
        return {
          ok: false,
          message:
            current.deal_type === "sale"
              ? `目标经纪人已达出售持盘上限（${hold.limit}）`
              : `目标经纪人已达出租持盘上限（${hold.limit}）`,
        };
      }
    }
    nextAgentId = payload.agent_id;
  } else if (payload.agent_id && payload.agent_id !== current.agent_id) {
    return { ok: false, message: "仅暂缓恢复上架时可顺带改接盘人" };
  }
  const now = nowIso();
  const remarkArg =
    payload.status === "suspended" || payload.status === "withdrawn"
      ? null
      : payload.reason || null;
  db.prepare(
    `UPDATE houses SET status = ?, agent_id = ?, suspend_reason = ?, withdraw_reason = ?,
       remark = COALESCE(?, remark), updated_at = ? WHERE id = ?`
  ).run(payload.status, nextAgentId, suspendReason, withdrawReason, remarkArg, now, payload.id);
  writeAudit(db, user, "house.status", "house", payload.id, {
    from: current.status,
    to: payload.status,
    reason:
      payload.status === "suspended"
        ? suspendReason
        : payload.status === "withdrawn" ? withdrawReason : payload.reason,
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
  } else if (nextAgentId && nextAgentId !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: current.store_id,
      user_id: nextAgentId,
      title: "房源状态已更新",
      body: `房源「${current.title}」：${current.status} → ${payload.status}`,
      kind: "house_agent",
      ref_type: "house",
      ref_id: current.id,
    });
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
  if (resolved.agent.role === "agent") {
    const hold = agentHoldExceeded(
      db,
      user.company_id,
      payload.agent_id,
      current.deal_type
    );
    if (hold.exceeded) {
      return {
        ok: false,
        message:
          current.deal_type === "sale"
            ? `目标经纪人已达出售持盘上限（${hold.limit}）`
            : `目标经纪人已达出租持盘上限（${hold.limit}）`,
      };
    }
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
  if (payload.agent_id !== user.id) {
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
  }
  if (current.agent_id && current.agent_id !== user.id) {
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
  if (holder.id !== user.id) {
    const roleLabel =
      payload.role_type === "surveyor"
        ? "实勘人"
        : payload.role_type === "verifier"
          ? "核验人"
          : payload.role_type === "photographer"
            ? "摄影师"
            : payload.role_type === "floorplan"
              ? "户型人"
              : payload.role_type === "key_keeper"
                ? "钥匙人"
                : "委托人";
    createMessage(db, {
      company_id: user.company_id,
      store_id: house.store_id,
      user_id: holder.id,
      title: "房源角色已指派",
      body: `${house.title}：${roleLabel}${protectedUntil ? `，保护至 ${protectedUntil.slice(0, 10)}` : ""}`,
      kind: "house_role",
      ref_type: "house",
      ref_id: house.id,
    });
  }
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
  const reason = String(payload.reason || "").trim();
  if (protectedNow && !reason)
    return { ok: false, message: "保护期内解除须填写原因" };
  const house = db
    .prepare(`SELECT * FROM houses WHERE id=? AND company_id=?`)
    .get(role.house_id, user.company_id) as any;
  db.prepare(`DELETE FROM house_role_holders WHERE id=?`).run(role.id);
  if (house && role.user_id && role.user_id !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: house.store_id,
      user_id: role.user_id,
      title: "房源角色已解除",
      body: reason
        ? `${house.title}：${role.role_type} · ${reason}`
        : `${house.title}：${role.role_type}`,
      kind: "house_role",
      ref_type: "house",
      ref_id: house.id,
    });
  }
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
  const currentPresented = presentHouse(db, user, current);
  return {
    ok: true,
    data: {
      house_id: current.id,
      owner_name: current.owner_name,
      owner_phone: currentPresented.owner_phone,
      owner_phone_masked: currentPresented.owner_phone_masked,
      related_count: related.length,
      items: related,
    },
  };
}
