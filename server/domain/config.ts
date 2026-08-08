import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

export function getPreferences(db: Db, user: SessionUser): ApiResult {
  const row = db.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`).get(user.id);
  return {
    ok: true,
    data: row || {
      user_id: user.id,
      list_density: "comfortable",
      watermark_enabled: 0,
      theme: "light",
    },
  };
}

export function savePreferences(db: Db, user: SessionUser, p: any): ApiResult {
  if (!["compact", "comfortable"].includes(p.list_density))
    return { ok: false, message: "列表密度无效" };
  if (!["light", "dark", "system"].includes(p.theme))
    return { ok: false, message: "主题无效" };
  db.prepare(
    `INSERT INTO user_preferences(user_id, company_id, list_density, watermark_enabled, theme, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET list_density=excluded.list_density,
     watermark_enabled=excluded.watermark_enabled, theme=excluded.theme, updated_at=excluded.updated_at`
  ).run(user.id, user.company_id, p.list_density, p.watermark_enabled ? 1 : 0, p.theme, nowIso());
  return getPreferences(db, user);
}

export const DEFAULT_FOLLOW_METHODS = [
  { value: "phone", label: "电话", sort_order: 1 },
  { value: "wechat", label: "微信", sort_order: 2 },
  { value: "visit", label: "拜访", sort_order: 3 },
  { value: "other", label: "其他", sort_order: 4 },
];

export function resolveFollowMethods(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'follow_method' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_FOLLOW_METHODS.map((item) => ({ ...item }));
}

export function normalizeFollowMethod(method: unknown): string {
  const value = String(method || "other").trim();
  if (value === "call") return "phone";
  return value || "other";
}

export function isAllowedFollowMethod(db: Db, companyId: string, method: string): boolean {
  const normalized = normalizeFollowMethod(method);
  return resolveFollowMethods(db, companyId).some((item) => item.value === normalized);
}

export function listFollowMethods(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveFollowMethods(db, user.company_id) };
}

export function listDictionary(db: Db, user: SessionUser, p: any): ApiResult {
  return {
    ok: true,
    data: db
      .prepare(
        `SELECT * FROM data_dictionaries WHERE company_id = ? AND status = 'active'
         AND (? IS NULL OR dict_type = ?) ORDER BY dict_type, sort_order, label`
      )
      .all(user.company_id, p.dict_type || null, p.dict_type || null),
  };
}

export function upsertDictionary(db: Db, user: SessionUser, p: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  if (!p.dict_type || !p.value || !p.label) return { ok: false, message: "字典信息不完整" };
  const id = p.id || nextId("DIC");
  db.prepare(
    `INSERT INTO data_dictionaries(id, company_id, dict_type, value, label, sort_order, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(company_id, dict_type, value) DO UPDATE SET label=excluded.label,
     sort_order=excluded.sort_order, status='active', updated_at=excluded.updated_at`
  ).run(id, user.company_id, p.dict_type, p.value, p.label, Number(p.sort_order || 0), user.id, nowIso(), nowIso());
  writeAudit(db, user, "dictionary.upsert", "dictionary", id, p);
  return { ok: true, data: { id } };
}

export function getSettings(db: Db, user: SessionUser): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  const row = db.prepare(`SELECT * FROM settings WHERE company_id = ?`).get(user.company_id) as any;
  return {
    ok: true,
    data: { ...row, deal_required_fields: JSON.parse(row?.deal_required_fields || "[]") },
  };
}

export function saveSettings(db: Db, user: SessionUser, p: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM settings WHERE company_id = ?`)
    .get(user.company_id) as any;
  const hold = Number(p.house_hold_limit);
  const award = Number(p.manager_award_rate);
  const min = Number(p.password_min_length);
  const protectionDays = Number(p.house_role_protection_days ?? 30);
  if (!Number.isInteger(hold) || hold < 1 || hold > 100)
    return { ok: false, message: "持盘上限须为 1～100" };
  if (award < 0 || award > 0.5) return { ok: false, message: "管理奖比例须为 0～0.5" };
  if (!Number.isInteger(min) || min < 8 || min > 32)
    return { ok: false, message: "密码最小长度须为 8～32" };
  if (!Number.isInteger(protectionDays) || protectionDays < 0 || protectionDays > 365)
    return { ok: false, message: "角色保护期须为 0～365 天" };
  const forceFollow =
    p.force_follow_before_phone === undefined
      ? Number(current?.force_follow_before_phone || 0)
      : p.force_follow_before_phone
        ? 1
        : 0;
  const nonHolderRemind =
    p.non_holder_view_remind === undefined
      ? Number(current?.non_holder_view_remind ?? 1)
      : p.non_holder_view_remind
        ? 1
        : 0;
  db.prepare(
    `UPDATE settings SET house_hold_limit=?, manager_award_rate=?, deal_required_fields=?,
     password_min_length=?, deal_doc_required=?, house_role_protection_days=?,
     force_follow_before_phone=?, non_holder_view_remind=?,
     updated_by=?, updated_at=? WHERE company_id=?`
  ).run(
    hold,
    award,
    JSON.stringify(p.deal_required_fields || []),
    min,
    p.deal_doc_required ? 1 : 0,
    protectionDays,
    forceFollow,
    nonHolderRemind,
    user.id,
    nowIso(),
    user.company_id
  );
  writeAudit(db, user, "settings.update", "settings", user.company_id);
  return getSettings(db, user);
}

export function listCommissionTiers(db: Db, user: SessionUser): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  return {
    ok: true,
    data: db
      .prepare(
        `SELECT * FROM commission_tiers WHERE company_id=? AND status='active'
         ORDER BY min_amount`
      )
      .all(user.company_id),
  };
}

export function saveCommissionTier(db: Db, user: SessionUser, p: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const min = Number(p.min_amount);
  const max = p.max_amount == null || p.max_amount === "" ? null : Number(p.max_amount);
  const rate = Number(p.pool_rate);
  if (min < 0 || (max != null && max < min) || rate <= 0 || rate > 1)
    return { ok: false, message: "阶梯范围或经纪人池比例无效" };
  const id = nextId("TIER");
  db.prepare(
    `INSERT INTO commission_tiers(id, company_id, min_amount, max_amount, pool_rate,
     status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(id, user.company_id, min, max, rate, user.id, nowIso(), nowIso());
  writeAudit(db, user, "commission_tier.create", "commission_tier", id, p);
  return { ok: true, data: { id } };
}
