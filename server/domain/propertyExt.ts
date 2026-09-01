import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/database";
import { houseVisibleTo } from "../auth/policy";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const MEDIA_TYPES = new Set(["video", "panorama"]);
const AGENCY_TYPES = new Set(["exclusive", "package"]);

function addEvent(
  db: Db,
  user: SessionUser,
  entityType: string,
  entityId: string,
  eventType: string,
  details: unknown = {}
) {
  db.prepare(
    `INSERT INTO property_ext_events(
      id, company_id, entity_type, entity_id, event_type, details, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("PXE"),
    user.company_id,
    entityType,
    entityId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function canManageHouse(user: SessionUser, house: any): boolean {
  return (
    user.role === "admin" ||
    (user.role === "store_manager" && house.store_id === user.store_id) ||
    house.agent_id === user.id
  );
}

function getWritableHouse(db: Db, user: SessionUser, houseId: string) {
  if (user.role === "finance") return null;
  const house = db
    .prepare(`SELECT * FROM houses WHERE id=? AND company_id=?`)
    .get(houseId, user.company_id) as any;
  if (!house || !houseVisibleTo(user, house) || !canManageHouse(user, house))
    return null;
  return house;
}

export function propertyExtOptions(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance")
    return { ok: true, data: { houses: [], users: [] } };
  let houses = db
    .prepare(
      `SELECT id, store_id, title, community, deal_type, deal_mode, status,
              agent_id, is_locked, owner_name
       FROM houses
       WHERE company_id=? AND status NOT IN ('closed','withdrawn')
       ORDER BY updated_at DESC`
    )
    .all(user.company_id) as any[];
  houses = houses.filter((house) => houseVisibleTo(user, house));
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' AND role IN ('agent','store_manager')
       ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  if (user.role !== "admin") {
    users = users.filter((row) => row.store_id === user.store_id);
  }
  return { ok: true, data: { houses, users } };
}

export function listLocks(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT h.id, h.store_id, h.title, h.community, h.deal_type, h.status,
              h.is_locked, h.locked_by, h.locked_at, h.lock_reason, h.lock_until,
              h.agent_id, u.display_name AS locked_by_name, a.display_name AS agent_name
       FROM houses h
       LEFT JOIN users u ON u.id=h.locked_by
       JOIN users a ON a.id=h.agent_id
       WHERE h.company_id=? AND h.is_locked=1
       ORDER BY h.locked_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => houseVisibleTo(user, row));
  if (payload.keyword) {
    const keyword = String(payload.keyword);
    rows = rows.filter(
      (row) => row.title.includes(keyword) || row.community.includes(keyword)
    );
  }
  return { ok: true, data: rows };
}

export function setLock(db: Db, user: SessionUser, payload: any): ApiResult {
  const house = getWritableHouse(db, user, payload.id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  const locked = Boolean(payload.locked);
  if (locked) {
    const reason = String(payload.reason || "").trim();
    if (reason.length < 2) return { ok: false, message: "锁定原因至少 2 个字" };
    let lockUntil: string | null = null;
    if (payload.lock_until) {
      const value = String(payload.lock_until);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return { ok: false, message: "锁定到期日格式应为 YYYY-MM-DD" };
      if (value < nowIso().slice(0, 10))
        return { ok: false, message: "锁定到期日不能早于今天" };
      lockUntil = value;
    }
    const now = nowIso();
    db.prepare(
      `UPDATE houses
       SET is_locked=1, locked_by=?, locked_at=?, lock_reason=?, lock_until=?, updated_at=?
       WHERE id=?`
    ).run(user.id, now, reason, lockUntil, now, house.id);
    addEvent(db, user, "lock", house.id, "locked", { reason, lock_until: lockUntil });
    writeAudit(db, user, "propertyExt.lock", "house", house.id, { reason });
    if (house.agent_id && house.agent_id !== user.id) {
      createMessage(db, {
        company_id: user.company_id,
        store_id: house.store_id,
        user_id: house.agent_id,
        title: "房源已锁定",
        body: `${house.title} · ${reason}`,
        kind: "business_record_status",
        ref_type: "house",
        ref_id: house.id,
      });
    }
    return { ok: true, data: { id: house.id, is_locked: 1, lock_reason: reason } };
  }
  const unlockReason = String(payload.reason || "").trim();
  if (unlockReason.length < 2) return { ok: false, message: "解锁原因至少 2 个字" };
  const now = nowIso();
  db.prepare(
    `UPDATE houses
     SET is_locked=0, locked_by=NULL, locked_at=NULL, lock_reason=NULL, lock_until=NULL, updated_at=?
     WHERE id=?`
  ).run(now, house.id);
  addEvent(db, user, "lock", house.id, "unlocked", { reason: unlockReason });
  writeAudit(db, user, "propertyExt.unlock", "house", house.id, {
    reason: unlockReason,
  });
  if (house.agent_id && house.agent_id !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: house.store_id,
      user_id: house.agent_id,
      title: "房源已解锁",
      body: `${house.title} · ${unlockReason}`,
      kind: "business_record_status",
      ref_type: "house",
      ref_id: house.id,
    });
  }
  return { ok: true, data: { id: house.id, is_locked: 0 } };
}

export function listCooperations(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT c.*, h.title AS house_title, h.community,
              u.display_name AS partner_user_name
       FROM house_cooperations c
       JOIN houses h ON h.id=c.house_id
       LEFT JOIN users u ON u.id=c.partner_user_id
       WHERE c.company_id=?
       ORDER BY c.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    const house = db
      .prepare(`SELECT * FROM houses WHERE id=?`)
      .get(row.house_id) as any;
    return house && houseVisibleTo(user, house);
  });
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.house_id) rows = rows.filter((row) => row.house_id === payload.house_id);
  return { ok: true, data: rows };
}

export function createCooperation(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  const house = getWritableHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  if (["closed", "withdrawn"].includes(house.status))
    return { ok: false, message: "当前房源状态不可建立合作" };
  const partnerName = String(payload.partner_name || "").trim();
  if (partnerName.length < 2) return { ok: false, message: "合作方名称至少 2 个字" };
  let partnerUserId = payload.partner_user_id || null;
  if (partnerUserId) {
    const partner = db
      .prepare(
        `SELECT id, display_name FROM users
         WHERE id=? AND company_id=? AND status='active' AND role<>'finance'`
      )
      .get(partnerUserId, user.company_id) as any;
    if (!partner) return { ok: false, message: "合作员工不存在" };
    if (partner.id === house.agent_id)
      return { ok: false, message: "不能与接盘人本人建立合作" };
  }
  const shareRatio =
    payload.share_ratio === undefined || payload.share_ratio === null || payload.share_ratio === ""
      ? null
      : Number(payload.share_ratio);
  if (
    shareRatio !== null &&
    (!Number.isFinite(shareRatio) || shareRatio <= 0 || shareRatio >= 100)
  )
    return { ok: false, message: "合作分成须在 0 到 100 之间" };
  const activeSame = db
    .prepare(
      `SELECT id FROM house_cooperations
       WHERE house_id=? AND status='active'
         AND (
           (? IS NOT NULL AND partner_user_id=?)
           OR (partner_name=? AND IFNULL(partner_phone,'')=?)
         )`
    )
    .get(
      house.id,
      partnerUserId,
      partnerUserId,
      partnerName,
      String(payload.partner_phone || "").trim()
    ) as any;
  if (activeSame) return { ok: false, message: "已存在相同有效合作方", code: 409 };
  const id = nextId("HCO");
  const now = nowIso();
  db.prepare(
    `INSERT INTO house_cooperations(
       id, company_id, store_id, house_id, partner_user_id, partner_name, partner_phone,
       share_ratio, status, note, started_at, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    house.store_id,
    house.id,
    partnerUserId,
    partnerName,
    String(payload.partner_phone || "").trim() || null,
    shareRatio,
    String(payload.note || "").trim() || null,
    now,
    user.id,
    now,
    now
  );
  if (partnerUserId && partnerUserId !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: house.store_id,
      user_id: partnerUserId,
      title: "房源合作已建立",
      body: `${house.title} 已与你建立合作`,
      kind: "house_cooperation",
      ref_type: "house_cooperation",
      ref_id: id,
    });
  }
  addEvent(db, user, "cooperation", id, "created", { house_id: house.id });
  writeAudit(db, user, "propertyExt.cooperation.create", "house_cooperation", id);
  return { ok: true, data: { id, status: "active" } };
}

export function endCooperation(db: Db, user: SessionUser, payload: any): ApiResult {
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "结束原因至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM house_cooperations WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "合作记录不存在", code: 404 };
  const house = getWritableHouse(db, user, row.house_id);
  if (!house) return { ok: false, message: "无权限结束该合作", code: 403 };
  if (row.status !== "active") return { ok: false, message: "合作已结束" };
  const now = nowIso();
  db.prepare(
    `UPDATE house_cooperations
     SET status='ended', ended_at=?, end_reason=?, updated_at=? WHERE id=?`
  ).run(now, reason, now, row.id);
  if (row.partner_user_id && row.partner_user_id !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.partner_user_id,
      title: "房源合作已结束",
      body: reason,
      kind: "house_cooperation",
      ref_type: "house_cooperation",
      ref_id: row.id,
    });
  }
  addEvent(db, user, "cooperation", row.id, "ended", { reason });
  writeAudit(db, user, "propertyExt.cooperation.end", "house_cooperation", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id, status: "ended" } };
}

export function listMedia(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT m.*, h.title AS house_title, h.community
       FROM house_media m
       JOIN houses h ON h.id=m.house_id
       WHERE m.company_id=?
       ORDER BY m.sort_order ASC, m.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    const house = db
      .prepare(`SELECT * FROM houses WHERE id=?`)
      .get(row.house_id) as any;
    return house && houseVisibleTo(user, house);
  });
  if (payload.house_id) rows = rows.filter((row) => row.house_id === payload.house_id);
  if (payload.media_type)
    rows = rows.filter((row) => row.media_type === payload.media_type);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function addMedia(db: Db, user: SessionUser, payload: any): ApiResult {
  const house = getWritableHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  if (!MEDIA_TYPES.has(payload.media_type))
    return { ok: false, message: "媒体类型无效" };
  const title = String(payload.title || "").trim();
  if (title.length < 2) return { ok: false, message: "媒体标题至少 2 个字" };
  const localPath = path.resolve(String(payload.local_path || ""));
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile())
    return { ok: false, message: "本地媒体文件不存在" };
  const sortOrder = Number(payload.sort_order ?? 0);
  if (!Number.isInteger(sortOrder) || sortOrder < 0)
    return { ok: false, message: "排序值无效" };
  const id = nextId("HMD");
  const now = nowIso();
  db.prepare(
    `INSERT INTO house_media(
       id, company_id, store_id, house_id, media_type, title, local_path,
       status, sort_order, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    house.store_id,
    house.id,
    payload.media_type,
    title,
    localPath,
    sortOrder,
    user.id,
    now,
    now
  );
  addEvent(db, user, "media", id, "created", {
    house_id: house.id,
    media_type: payload.media_type,
  });
  writeAudit(db, user, "propertyExt.media.add", "house_media", id);
  return { ok: true, data: { id, status: "active" } };
}

export function archiveMedia(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM house_media WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "媒体不存在", code: 404 };
  const house = getWritableHouse(db, user, row.house_id);
  if (!house) return { ok: false, message: "无权限归档该媒体", code: 403 };
  if (row.status !== "active") return { ok: false, message: "媒体已归档" };
  const now = nowIso();
  db.prepare(
    `UPDATE house_media SET status='archived', updated_at=? WHERE id=?`
  ).run(now, row.id);
  addEvent(db, user, "media", row.id, "archived");
  writeAudit(db, user, "propertyExt.media.archive", "house_media", row.id);
  return { ok: true, data: { id: row.id, status: "archived" } };
}

export function getAuction(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const house = db
    .prepare(`SELECT * FROM houses WHERE id=? AND company_id=?`)
    .get(payload.house_id, user.company_id) as any;
  if (!house || !houseVisibleTo(user, house))
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  const profile = db
    .prepare(`SELECT * FROM house_auction_profiles WHERE house_id=?`)
    .get(house.id) as any;
  return { ok: true, data: profile || null };
}

export function saveAuction(db: Db, user: SessionUser, payload: any): ApiResult {
  const house = getWritableHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  const startingPrice = Number(payload.starting_price);
  if (!Number.isFinite(startingPrice) || startingPrice <= 0)
    return { ok: false, message: "起拍价须大于 0" };
  const reservePrice =
    payload.reserve_price === undefined ||
    payload.reserve_price === null ||
    payload.reserve_price === ""
      ? null
      : Number(payload.reserve_price);
  if (reservePrice !== null && (!Number.isFinite(reservePrice) || reservePrice < startingPrice))
    return { ok: false, message: "保留价不能低于起拍价" };
  const now = nowIso();
  const existing = db
    .prepare(`SELECT * FROM house_auction_profiles WHERE house_id=?`)
    .get(house.id) as any;
  if (existing) {
    if (existing.status === "completed")
      return { ok: false, message: "已完成拍卖不可再改" };
    db.prepare(
      `UPDATE house_auction_profiles
       SET court_name=?, case_no=?, starting_price=?, reserve_price=?,
           auction_start=?, auction_end=?, remark=?, updated_at=?
       WHERE house_id=?`
    ).run(
      String(payload.court_name || "").trim() || null,
      String(payload.case_no || "").trim() || null,
      startingPrice,
      reservePrice,
      String(payload.auction_start || "").trim() || null,
      String(payload.auction_end || "").trim() || null,
      String(payload.remark || "").trim() || null,
      now,
      house.id
    );
    addEvent(db, user, "auction", house.id, "updated");
    writeAudit(db, user, "propertyExt.auction.update", "house_auction_profile", house.id);
    return { ok: true, data: { house_id: house.id, status: existing.status } };
  }
  db.prepare(
    `INSERT INTO house_auction_profiles(
       house_id, company_id, store_id, court_name, case_no, starting_price,
       reserve_price, auction_start, auction_end, status, remark,
       created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(
    house.id,
    user.company_id,
    house.store_id,
    String(payload.court_name || "").trim() || null,
    String(payload.case_no || "").trim() || null,
    startingPrice,
    reservePrice,
    String(payload.auction_start || "").trim() || null,
    String(payload.auction_end || "").trim() || null,
    String(payload.remark || "").trim() || null,
    user.id,
    now,
    now
  );
  addEvent(db, user, "auction", house.id, "created");
  writeAudit(db, user, "propertyExt.auction.create", "house_auction_profile", house.id);
  return { ok: true, data: { house_id: house.id, status: "draft" } };
}

export function activateAuction(db: Db, user: SessionUser, payload: any): ApiResult {
  const house = getWritableHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  const profile = db
    .prepare(`SELECT * FROM house_auction_profiles WHERE house_id=?`)
    .get(house.id) as any;
  if (!profile) return { ok: false, message: "请先保存拍卖资料" };
  if (!["draft", "cancelled"].includes(profile.status))
    return { ok: false, message: "当前拍卖状态不可启用" };
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE house_auction_profiles SET status='active', updated_at=? WHERE house_id=?`
    ).run(now, house.id);
    db.prepare(
      `UPDATE houses SET deal_mode='auction', updated_at=? WHERE id=?`
    ).run(now, house.id);
  });
  tx();
  addEvent(db, user, "auction", house.id, "activated");
  writeAudit(db, user, "propertyExt.auction.activate", "house_auction_profile", house.id);
  return { ok: true, data: { house_id: house.id, status: "active" } };
}

export function completeAuction(db: Db, user: SessionUser, payload: any): ApiResult {
  const house = getWritableHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  const profile = db
    .prepare(`SELECT * FROM house_auction_profiles WHERE house_id=?`)
    .get(house.id) as any;
  if (!profile || profile.status !== "active")
    return { ok: false, message: "仅进行中拍卖可完成" };
  const now = nowIso();
  db.prepare(
    `UPDATE house_auction_profiles SET status='completed', updated_at=? WHERE house_id=?`
  ).run(now, house.id);
  addEvent(db, user, "auction", house.id, "completed");
  writeAudit(db, user, "propertyExt.auction.complete", "house_auction_profile", house.id);
  return { ok: true, data: { house_id: house.id, status: "completed" } };
}

export function getExclusive(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const house = db
    .prepare(`SELECT * FROM houses WHERE id=? AND company_id=?`)
    .get(payload.house_id, user.company_id) as any;
  if (!house || !houseVisibleTo(user, house))
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  const profile = db
    .prepare(`SELECT * FROM house_exclusive_profiles WHERE house_id=?`)
    .get(house.id) as any;
  return { ok: true, data: profile || null };
}

export function saveExclusive(db: Db, user: SessionUser, payload: any): ApiResult {
  const house = getWritableHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  if (!AGENCY_TYPES.has(payload.agency_type))
    return { ok: false, message: "代理类型无效" };
  const startDate = String(payload.start_date || "").trim();
  const endDate = String(payload.end_date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
    return { ok: false, message: "代理起止日期无效" };
  if (endDate < startDate) return { ok: false, message: "结束日期不能早于开始日期" };
  const packagePrice =
    payload.package_price === undefined ||
    payload.package_price === null ||
    payload.package_price === ""
      ? null
      : Number(payload.package_price);
  if (payload.agency_type === "package") {
    if (!Number.isFinite(packagePrice as number) || (packagePrice as number) <= 0)
      return { ok: false, message: "包销价须大于 0" };
  }
  const now = nowIso();
  const existing = db
    .prepare(`SELECT * FROM house_exclusive_profiles WHERE house_id=?`)
    .get(house.id) as any;
  if (existing) {
    if (existing.status === "ended")
      return { ok: false, message: "已结束的独家/包销不可再改" };
    db.prepare(
      `UPDATE house_exclusive_profiles
       SET agency_type=?, start_date=?, end_date=?, package_price=?,
           commission_rule=?, remark=?, updated_at=?
       WHERE house_id=?`
    ).run(
      payload.agency_type,
      startDate,
      endDate,
      packagePrice,
      String(payload.commission_rule || "").trim() || null,
      String(payload.remark || "").trim() || null,
      now,
      house.id
    );
    addEvent(db, user, "exclusive", house.id, "updated");
    writeAudit(db, user, "propertyExt.exclusive.update", "house_exclusive_profile", house.id);
    return { ok: true, data: { house_id: house.id, status: existing.status } };
  }
  db.prepare(
    `INSERT INTO house_exclusive_profiles(
       house_id, company_id, store_id, agency_type, start_date, end_date,
       package_price, commission_rule, status, remark, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(
    house.id,
    user.company_id,
    house.store_id,
    payload.agency_type,
    startDate,
    endDate,
    packagePrice,
    String(payload.commission_rule || "").trim() || null,
    String(payload.remark || "").trim() || null,
    user.id,
    now,
    now
  );
  addEvent(db, user, "exclusive", house.id, "created");
  writeAudit(db, user, "propertyExt.exclusive.create", "house_exclusive_profile", house.id);
  return { ok: true, data: { house_id: house.id, status: "draft" } };
}

export function activateExclusive(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  const house = getWritableHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  const profile = db
    .prepare(`SELECT * FROM house_exclusive_profiles WHERE house_id=?`)
    .get(house.id) as any;
  if (!profile) return { ok: false, message: "请先保存独家/包销资料" };
  if (!["draft", "cancelled"].includes(profile.status))
    return { ok: false, message: "当前状态不可启用" };
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE house_exclusive_profiles SET status='active', updated_at=? WHERE house_id=?`
    ).run(now, house.id);
    db.prepare(
      `UPDATE houses SET deal_mode='exclusive', updated_at=? WHERE id=?`
    ).run(now, house.id);
  });
  tx();
  addEvent(db, user, "exclusive", house.id, "activated", {
    agency_type: profile.agency_type,
  });
  writeAudit(db, user, "propertyExt.exclusive.activate", "house_exclusive_profile", house.id);
  return { ok: true, data: { house_id: house.id, status: "active" } };
}

export function endExclusive(db: Db, user: SessionUser, payload: any): ApiResult {
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "结束原因至少 2 个字" };
  const house = getWritableHouse(db, user, payload.house_id);
  if (!house) return { ok: false, message: "房源不存在或无权限", code: 403 };
  const profile = db
    .prepare(`SELECT * FROM house_exclusive_profiles WHERE house_id=?`)
    .get(house.id) as any;
  if (!profile || profile.status !== "active")
    return { ok: false, message: "仅生效中的独家/包销可结束" };
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE house_exclusive_profiles
       SET status='ended', remark=CASE WHEN remark IS NULL OR remark='' THEN ? ELSE remark || '；' || ? END,
           updated_at=?
       WHERE house_id=?`
    ).run(reason, reason, now, house.id);
    if (house.deal_mode === "exclusive") {
      db.prepare(`UPDATE houses SET deal_mode='normal', updated_at=? WHERE id=?`).run(
        now,
        house.id
      );
    }
  });
  tx();
  addEvent(db, user, "exclusive", house.id, "ended", { reason });
  writeAudit(db, user, "propertyExt.exclusive.end", "house_exclusive_profile", house.id, {
    reason,
  });
  return { ok: true, data: { house_id: house.id, status: "ended" } };
}
