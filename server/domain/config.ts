import type { Db } from "../db/database";

import { writeAudit } from "./audit";

import { createMessage } from "./message";

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

export const DEFAULT_CUSTOMER_SOURCES = [
  { value: "门店到访", label: "门店到访", sort_order: 1 },
  { value: "转介", label: "转介", sort_order: 2 },
  { value: "官网", label: "官网", sort_order: 3 },
  { value: "来电", label: "来电", sort_order: 4 },
  { value: "小程序", label: "小程序", sort_order: 5 },
  { value: "其他", label: "其他", sort_order: 6 },
];

const CUSTOMER_SOURCE_ALIASES: Record<string, string> = {
  walk_in: "门店到访",
  referral: "转介",
  website: "官网",
  online: "官网",
  phone_in: "来电",
  phone: "来电",
  other: "其他",
};

export function resolveCustomerSources(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'customer_source' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_CUSTOMER_SOURCES.map((item) => ({ ...item }));
}

export function normalizeCustomerSource(source: unknown): string | null {
  const raw = String(source ?? "").trim();
  if (!raw) return null;
  return CUSTOMER_SOURCE_ALIASES[raw] || raw;
}

export function isAllowedCustomerSource(db: Db, companyId: string, source: string): boolean {
  return resolveCustomerSources(db, companyId).some((item) => item.value === source);
}

export function labelCustomerSource(db: Db, companyId: string, source: unknown): string {
  const normalized = normalizeCustomerSource(source);
  if (!normalized) return "";
  const hit = resolveCustomerSources(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function listCustomerSources(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveCustomerSources(db, user.company_id) };
}

export const DEFAULT_CUSTOMER_LEVELS = [
  { value: "A", label: "A级", sort_order: 1 },
  { value: "B", label: "B级", sort_order: 2 },
  { value: "C", label: "C级", sort_order: 3 },
];

const CUSTOMER_LEVEL_ALIASES: Record<string, string> = {
  a: "A",
  b: "B",
  c: "C",
  A级: "A",
  B级: "B",
  C级: "C",
};

export function resolveCustomerLevels(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'customer_level' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_CUSTOMER_LEVELS.map((item) => ({ ...item }));
}

export function normalizeCustomerLevel(level: unknown, fallback = "B"): string {
  const raw = String(level ?? "").trim();
  if (!raw) return fallback;
  return CUSTOMER_LEVEL_ALIASES[raw] || CUSTOMER_LEVEL_ALIASES[raw.toLowerCase()] || raw;
}

export function isAllowedCustomerLevel(db: Db, companyId: string, level: string): boolean {
  return resolveCustomerLevels(db, companyId).some((item) => item.value === level);
}

export function labelCustomerLevel(db: Db, companyId: string, level: unknown): string {
  const normalized = normalizeCustomerLevel(level, "");
  if (!normalized) return "";
  const hit = resolveCustomerLevels(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function listCustomerLevels(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveCustomerLevels(db, user.company_id) };
}

export const DEFAULT_PAYMENT_METHODS = [
  { value: "transfer", label: "转账", sort_order: 1 },
  { value: "cash", label: "现金", sort_order: 2 },
  { value: "wechat", label: "微信", sort_order: 3 },
  { value: "alipay", label: "支付宝", sort_order: 4 },
  { value: "other", label: "其他", sort_order: 5 },
];

const PAYMENT_METHOD_ALIASES: Record<string, string> = {
  bank: "transfer",
  转账: "transfer",
  银行转账: "transfer",
  现金: "cash",
  微信: "wechat",
  支付宝: "alipay",
  其他: "other",
};

export function resolvePaymentMethods(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'payment_method' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_PAYMENT_METHODS.map((item) => ({ ...item }));
}

export function normalizePaymentMethod(method: unknown, fallback = "transfer"): string {
  const raw = String(method ?? "").trim();
  if (!raw) return fallback;
  return PAYMENT_METHOD_ALIASES[raw] || raw;
}

export function isAllowedPaymentMethod(db: Db, companyId: string, method: string): boolean {
  return resolvePaymentMethods(db, companyId).some((item) => item.value === method);
}

export function labelPaymentMethod(db: Db, companyId: string, method: unknown): string {
  const normalized = normalizePaymentMethod(method, "");
  if (!normalized) return "";
  const hit = resolvePaymentMethods(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function listPaymentMethods(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolvePaymentMethods(db, user.company_id) };
}

export const DEFAULT_DEAL_MODES = [
  { value: "normal", label: "普通", sort_order: 1 },
  { value: "auction", label: "拍卖", sort_order: 2 },
  { value: "exclusive", label: "包销/独家", sort_order: 3 },
];

const DEAL_MODE_ALIASES: Record<string, string> = {
  普通: "normal",
  拍卖: "auction",
  包销: "exclusive",
  独家: "exclusive",
  "包销/独家": "exclusive",
  package: "exclusive",
};

export function resolveDealModes(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'deal_mode' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_DEAL_MODES.map((item) => ({ ...item }));
}

export function normalizeDealMode(value: unknown, fallback = "normal"): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return DEAL_MODE_ALIASES[raw] || raw;
}

export function isAllowedDealMode(db: Db, companyId: string, value: string): boolean {
  return resolveDealModes(db, companyId).some((item) => item.value === value);
}

export function labelDealMode(db: Db, companyId: string, value: unknown): string {
  const normalized = normalizeDealMode(value, "");
  if (!normalized) return "";
  const hit = resolveDealModes(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function listDealModes(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveDealModes(db, user.company_id) };
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  { value: "transport", label: "交通", sort_order: 1 },
  { value: "travel", label: "差旅", sort_order: 2 },
  { value: "office", label: "办公用品", sort_order: 3 },
  { value: "marketing", label: "营销推广", sort_order: 4 },
  { value: "hospitality", label: "业务招待", sort_order: 5 },
  { value: "other", label: "其他", sort_order: 6 },
];

const EXPENSE_CATEGORY_ALIASES: Record<string, string> = {
  交通: "transport",
  交通费: "transport",
  差旅: "travel",
  差旅费: "travel",
  办公: "office",
  办公用品: "office",
  营销: "marketing",
  营销推广: "marketing",
  招待: "hospitality",
  业务招待: "hospitality",
  其他: "other",
};

export function resolveExpenseCategories(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'expense_category' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_EXPENSE_CATEGORIES.map((item) => ({ ...item }));
}

export function normalizeExpenseCategory(category: unknown, fallback = ""): string {
  const raw = String(category ?? "").trim();
  if (!raw) return fallback;
  return EXPENSE_CATEGORY_ALIASES[raw] || raw;
}

export function isAllowedExpenseCategory(db: Db, companyId: string, category: string): boolean {
  return resolveExpenseCategories(db, companyId).some((item) => item.value === category);
}

export function labelExpenseCategory(db: Db, companyId: string, category: unknown): string {
  const normalized = normalizeExpenseCategory(category);
  if (!normalized) return "";
  const hit = resolveExpenseCategories(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function listExpenseCategories(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveExpenseCategories(db, user.company_id) };
}

export const DEFAULT_HOUSE_SOURCES = [
  { value: "门店到访", label: "门店到访", sort_order: 1 },
  { value: "转介", label: "转介", sort_order: 2 },
  { value: "官网", label: "官网", sort_order: 3 },
  { value: "来电", label: "来电", sort_order: 4 },
  { value: "小程序", label: "小程序", sort_order: 5 },
  { value: "其他", label: "其他", sort_order: 6 },
];

const HOUSE_SOURCE_ALIASES: Record<string, string> = {
  walk_in: "门店到访",
  referral: "转介",
  website: "官网",
  online: "官网",
  phone_in: "来电",
  phone: "来电",
  other: "其他",
};

export function resolveHouseSources(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'house_source' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_HOUSE_SOURCES.map((item) => ({ ...item }));
}

export function normalizeHouseSource(source: unknown): string | null {
  const raw = String(source ?? "").trim();
  if (!raw) return null;
  return HOUSE_SOURCE_ALIASES[raw] || raw;
}

export function isAllowedHouseSource(db: Db, companyId: string, source: string): boolean {
  return resolveHouseSources(db, companyId).some((item) => item.value === source);
}

export function labelHouseSource(db: Db, companyId: string, source: unknown): string {
  const normalized = normalizeHouseSource(source);
  if (!normalized) return "";
  const hit = resolveHouseSources(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function listHouseSources(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveHouseSources(db, user.company_id) };
}

export const DEFAULT_LEAVE_TYPES = [
  { value: "annual", label: "年假", sort_order: 1 },
  { value: "sick", label: "病假", sort_order: 2 },
  { value: "personal", label: "事假", sort_order: 3 },
  { value: "other", label: "其他", sort_order: 4 },
];

const LEAVE_TYPE_ALIASES: Record<string, string> = {
  年假: "annual",
  病假: "sick",
  事假: "personal",
  其他: "other",
  其它: "other",
};

export function resolveLeaveTypes(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'leave_type' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_LEAVE_TYPES.map((item) => ({ ...item }));
}

export function normalizeLeaveType(leaveType: unknown, fallback = ""): string {
  const raw = String(leaveType ?? "").trim();
  if (!raw) return fallback;
  return LEAVE_TYPE_ALIASES[raw] || raw;
}

export function isAllowedLeaveType(db: Db, companyId: string, leaveType: string): boolean {
  return resolveLeaveTypes(db, companyId).some((item) => item.value === leaveType);
}

export function labelLeaveType(db: Db, companyId: string, leaveType: unknown): string {
  const normalized = normalizeLeaveType(leaveType);
  if (!normalized) return "";
  const hit = resolveLeaveTypes(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function listLeaveTypes(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveLeaveTypes(db, user.company_id) };
}

export const DEFAULT_PAY_TYPES = [
  { value: "commission", label: "佣金", sort_order: 1 },
  { value: "deposit", label: "定金", sort_order: 2 },
  { value: "earnest_apply", label: "意向金冲抵", sort_order: 3 },
  { value: "refund", label: "退款", sort_order: 4 },
  { value: "other", label: "其他", sort_order: 5 },
];

const PAY_TYPE_ALIASES: Record<string, string> = {
  佣金: "commission",
  定金: "deposit",
  意向金冲抵: "earnest_apply",
  earnest: "earnest_apply",
  退款: "refund",
  其他: "other",
};

export function resolvePayTypes(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'pay_type' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_PAY_TYPES.map((item) => ({ ...item }));
}

export function normalizePayType(payType: unknown, fallback = "commission"): string {
  const raw = String(payType ?? "").trim();
  if (!raw) return fallback;
  return PAY_TYPE_ALIASES[raw] || raw;
}

export function isAllowedPayType(db: Db, companyId: string, payType: string): boolean {
  return resolvePayTypes(db, companyId).some((item) => item.value === payType);
}

export function labelPayType(db: Db, companyId: string, payType: unknown): string {
  const normalized = normalizePayType(payType, "");
  if (!normalized) return "";
  const hit = resolvePayTypes(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function listPayTypes(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolvePayTypes(db, user.company_id) };
}

export const DEFAULT_PROPERTY_TYPES = [
  { value: "residential", label: "住宅", sort_order: 1 },
  { value: "shop", label: "商铺", sort_order: 2 },
  { value: "office", label: "写字楼", sort_order: 3 },
  { value: "parking", label: "车位", sort_order: 4 },
  { value: "villa", label: "别墅", sort_order: 5 },
];

const PROPERTY_TYPE_ALIASES: Record<string, string> = {
  apartment: "residential",
  commercial: "shop",
  住宅: "residential",
  商铺: "shop",
  写字楼: "office",
  车位: "parking",
  别墅: "villa",
};

export function resolvePropertyTypes(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'property_type' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_PROPERTY_TYPES.map((item) => ({ ...item }));
}

export function normalizePropertyType(value: unknown, fallback = "residential"): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return PROPERTY_TYPE_ALIASES[raw] || raw;
}

export function isAllowedPropertyType(db: Db, companyId: string, value: string): boolean {
  return resolvePropertyTypes(db, companyId).some((item) => item.value === value);
}

export function labelPropertyType(db: Db, companyId: string, value: unknown): string {
  const normalized = normalizePropertyType(value, "");
  if (!normalized) return "";
  const hit = resolvePropertyTypes(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function listPropertyTypes(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolvePropertyTypes(db, user.company_id) };
}

export const DEFAULT_VIEW_FEEDBACKS = [
  { value: "interested", label: "有意向", sort_order: 1 },
  { value: "considering", label: "考虑中", sort_order: 2 },
  { value: "rejected", label: "无意向", sort_order: 3 },
  { value: "deal", label: "可成交", sort_order: 4 },
];

const VIEW_FEEDBACK_ALIASES: Record<string, string> = {
  有意向: "interested",
  意向: "interested",
  考虑中: "considering",
  考虑: "considering",
  无意向: "rejected",
  拒绝: "rejected",
  看完不要: "rejected",
  可成交: "deal",
  成交: "deal",
};

export function resolveViewFeedbacks(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'view_feedback' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length ? rows : DEFAULT_VIEW_FEEDBACKS.map((item) => ({ ...item }));
}

export function normalizeViewFeedback(feedback: unknown, fallback = ""): string {
  const raw = String(feedback ?? "").trim();
  if (!raw) return fallback;
  return VIEW_FEEDBACK_ALIASES[raw] || raw;
}

export function isAllowedViewFeedback(db: Db, companyId: string, feedback: string): boolean {
  if (!feedback || feedback === "pending") return false;
  return resolveViewFeedbacks(db, companyId).some((item) => item.value === feedback);
}

export function labelViewFeedback(db: Db, companyId: string, feedback: unknown): string {
  const normalized = normalizeViewFeedback(feedback);
  if (!normalized) return "";
  if (normalized === "pending") return "待反馈";
  const hit = resolveViewFeedbacks(db, companyId).find((item) => item.value === normalized);
  return hit?.label || normalized;
}

export function isEffectiveViewFeedback(feedback: unknown): boolean {
  const normalized = normalizeViewFeedback(feedback);
  return ["interested", "considering", "deal"].includes(normalized);
}

export function isDealShortcutFeedback(feedback: unknown): boolean {
  const normalized = normalizeViewFeedback(feedback);
  return ["interested", "deal"].includes(normalized);
}

export function listViewFeedbacks(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveViewFeedbacks(db, user.company_id) };
}

export const DEFAULT_HOUSE_SUSPEND_REASONS = [
  { value: "owner_pause", label: "业主暂缓出售/出租", sort_order: 1 },
  { value: "price_adjust", label: "调价中", sort_order: 2 },
  { value: "decoration", label: "装修/整理中", sort_order: 3 },
  { value: "key_unavailable", label: "钥匙暂不可看", sort_order: 4 },
  { value: "other", label: "其他", sort_order: 5 },
];

const HOUSE_SUSPEND_REASON_ALIASES: Record<string, string> = {
  业主暂缓: "owner_pause",
  业主暂缓出售: "owner_pause",
  业主暂缓出租: "owner_pause",
  "业主暂缓出售/出租": "owner_pause",
  调价中: "price_adjust",
  装修中: "decoration",
  "装修/整理中": "decoration",
  钥匙暂不可看: "key_unavailable",
  其他: "other",
};

export function resolveHouseSuspendReasons(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'house_suspend_reason' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length
    ? rows
    : DEFAULT_HOUSE_SUSPEND_REASONS.map((item) => ({ ...item }));
}

export function normalizeHouseSuspendReason(reason: unknown, fallback = ""): string {
  const raw = String(reason ?? "").trim();
  if (!raw) return fallback;
  return HOUSE_SUSPEND_REASON_ALIASES[raw] || raw;
}

export function isAllowedHouseSuspendReason(
  db: Db,
  companyId: string,
  reason: string
): boolean {
  return resolveHouseSuspendReasons(db, companyId).some((item) => item.value === reason);
}

export function labelHouseSuspendReason(
  db: Db,
  companyId: string,
  reason: unknown
): string {
  const normalized = normalizeHouseSuspendReason(reason, "");
  if (!normalized) return "";
  const hit = resolveHouseSuspendReasons(db, companyId).find(
    (item) => item.value === normalized
  );
  return hit?.label || normalized;
}

export function listHouseSuspendReasons(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveHouseSuspendReasons(db, user.company_id) };
}

export const DEFAULT_HOUSE_WITHDRAW_REASONS = [
  { value: "owner_stopped", label: "业主不卖/不租", sort_order: 1 },
  { value: "sold_elsewhere", label: "已他售/他租", sort_order: 2 },
  { value: "price_mismatch", label: "价格不合适", sort_order: 3 },
  { value: "duplicate", label: "重复录入", sort_order: 4 },
  { value: "other", label: "其他", sort_order: 5 },
];

const HOUSE_WITHDRAW_REASON_ALIASES: Record<string, string> = {
  业主不卖: "owner_stopped",
  业主不卖了: "owner_stopped",
  业主不租: "owner_stopped",
  "业主不卖/不租": "owner_stopped",
  已他售: "sold_elsewhere",
  已他租: "sold_elsewhere",
  "已他售/他租": "sold_elsewhere",
  价格不合适: "price_mismatch",
  重复录入: "duplicate",
  其他: "other",
};

export function resolveHouseWithdrawReasons(db: Db, companyId: string) {
  const rows = db
    .prepare(
      `SELECT value, label, sort_order FROM data_dictionaries
       WHERE company_id = ? AND dict_type = 'house_withdraw_reason' AND status = 'active'
       ORDER BY sort_order, label`
    )
    .all(companyId) as Array<{ value: string; label: string; sort_order: number }>;
  return rows.length
    ? rows
    : DEFAULT_HOUSE_WITHDRAW_REASONS.map((item) => ({ ...item }));
}

export function normalizeHouseWithdrawReason(reason: unknown, fallback = ""): string {
  const raw = String(reason ?? "").trim();
  if (!raw) return fallback;
  return HOUSE_WITHDRAW_REASON_ALIASES[raw] || raw;
}

export function isAllowedHouseWithdrawReason(
  db: Db,
  companyId: string,
  reason: string
): boolean {
  return resolveHouseWithdrawReasons(db, companyId).some((item) => item.value === reason);
}

export function labelHouseWithdrawReason(
  db: Db,
  companyId: string,
  reason: unknown
): string {
  const normalized = normalizeHouseWithdrawReason(reason, "");
  if (!normalized) return "";
  const hit = resolveHouseWithdrawReasons(db, companyId).find(
    (item) => item.value === normalized
  );
  return hit?.label || normalized;
}

export function listHouseWithdrawReasons(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: resolveHouseWithdrawReasons(db, user.company_id) };
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
  const existing = db
    .prepare(
      `SELECT id FROM data_dictionaries
       WHERE company_id=? AND dict_type=? AND value=?`
    )
    .get(user.company_id, p.dict_type, p.value) as any;
  const id = existing?.id || p.id || nextId("DIC");
  db.prepare(
    `INSERT INTO data_dictionaries(id, company_id, dict_type, value, label, sort_order, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(company_id, dict_type, value) DO UPDATE SET label=excluded.label,
     sort_order=excluded.sort_order, status='active', updated_at=excluded.updated_at`
  ).run(id, user.company_id, p.dict_type, p.value, p.label, Number(p.sort_order || 0), user.id, nowIso(), nowIso());
  writeAudit(db, user, "dictionary.upsert", "dictionary", id, p);
  // 同键更新时提醒管理员/店长（首次新增由独立切片推送）
  if (existing) {
    const recipients = db
      .prepare(
        `SELECT id, store_id FROM users WHERE company_id=? AND status='active'
         AND role IN ('admin', 'store_manager')`
      )
      .all(user.company_id) as any[];
    const body = `${p.dict_type} · ${p.label}（${p.value}）`;
    for (const recipient of recipients) {
      if (recipient.id === user.id) continue;
      createMessage(db, {
        company_id: user.company_id,
        store_id: recipient.store_id,
        user_id: recipient.id,
        title: "数据字典已更新",
        body,
        kind: "business_record_status",
        ref_type: "dictionary",
        ref_id: id,
      });
    }
  }
  if (!existing) {
    const recipients = db
      .prepare(
        `SELECT id, store_id FROM users WHERE company_id=? AND status='active'
         AND role IN ('admin', 'store_manager')`
      )
      .all(user.company_id) as any[];
    const body = `${p.dict_type} · ${p.label}（${p.value}）`;
    for (const recipient of recipients) {
      if (recipient.id === user.id) continue;
      createMessage(db, {
        company_id: user.company_id,
        store_id: recipient.store_id,
        user_id: recipient.id,
        title: "数据字典已新增",
        body,
        kind: "business_record_status",
        ref_type: "dictionary",
        ref_id: id,
      });
    }
  }
  return { ok: true, data: { id } };
}

function presentSettings(row: any) {
  const legacy = Number(row?.house_hold_limit ?? 20);
  const sale = Number(row?.house_hold_limit_sale ?? legacy);
  const rent = Number(row?.house_hold_limit_rent ?? legacy);
  return {
    ...row,
    house_hold_limit: Math.max(sale, rent, legacy),
    house_hold_limit_sale: sale,
    house_hold_limit_rent: rent,
    password_max_age_days: Number(row?.password_max_age_days || 0),
    agent_pool_rate: Number(row?.agent_pool_rate ?? 0.5),
    public_pool_days: Number(row?.public_pool_days || 0),
    public_pool_enabled: Number(row?.public_pool_days || 0) > 0,
    deal_required_fields: JSON.parse(row?.deal_required_fields || "[]"),
  };
}

/** 按租售返回个人持盘上限；缺省回退 legacy house_hold_limit */
export function holdLimitForDealType(db: Db, companyId: string, dealType: string): number {
  const row = db.prepare(`SELECT * FROM settings WHERE company_id = ?`).get(companyId) as any;
  const legacy = Number(row?.house_hold_limit ?? 20);
  if (dealType === "sale") return Number(row?.house_hold_limit_sale ?? legacy);
  if (dealType === "rent") return Number(row?.house_hold_limit_rent ?? legacy);
  return legacy;
}

export function getSettings(db: Db, user: SessionUser): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  const row = db.prepare(`SELECT * FROM settings WHERE company_id = ?`).get(user.company_id) as any;
  return {
    ok: true,
    data: presentSettings(row),
  };
}

export function saveSettings(db: Db, user: SessionUser, p: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM settings WHERE company_id = ?`)
    .get(user.company_id) as any;
  const customerHold =
    p.customer_hold_limit === undefined
      ? Number(current?.customer_hold_limit ?? 20)
      : Number(p.customer_hold_limit);
  const legacyHold = Number(
    p.house_hold_limit ?? current?.house_hold_limit_sale ?? current?.house_hold_limit ?? 20
  );
  const holdSale = Number(
    p.house_hold_limit_sale != null ? p.house_hold_limit_sale : legacyHold
  );
  const holdRent = Number(
    p.house_hold_limit_rent != null ? p.house_hold_limit_rent : legacyHold
  );
  const award = Number(p.manager_award_rate);
  const min = Number(p.password_min_length);
  const protectionDays = Number(p.house_role_protection_days ?? 30);
  const maxAgeDays =
    p.password_max_age_days === undefined
      ? Number(current?.password_max_age_days || 0)
      : Number(p.password_max_age_days);
  if (!Number.isInteger(customerHold) || customerHold < 1 || customerHold > 100)
    return { ok: false, message: "暂缓客上限须为 1～100" };
  if (!Number.isInteger(holdSale) || holdSale < 1 || holdSale > 100)
    return { ok: false, message: "出售持盘上限须为 1～100" };
  if (!Number.isInteger(holdRent) || holdRent < 1 || holdRent > 100)
    return { ok: false, message: "出租持盘上限须为 1～100" };
  const agentPoolRate =
    p.agent_pool_rate === undefined
      ? Number(current?.agent_pool_rate ?? 0.5)
      : Number(p.agent_pool_rate);
  const publicPoolDays =
    p.public_pool_days === undefined
      ? Number(current?.public_pool_days || 0)
      : Number(p.public_pool_days);
  if (award < 0 || award > 0.5) return { ok: false, message: "管理奖比例须为 0～0.5" };
  if (!Number.isFinite(agentPoolRate) || agentPoolRate < 0 || agentPoolRate > 1)
    return { ok: false, message: "经纪人提成池比例须为 0～1" };
  if (!Number.isInteger(publicPoolDays) || publicPoolDays < 0 || publicPoolDays > 365)
    return { ok: false, message: "掉公天数须为 0～365 的整数" };
  if (!Number.isInteger(min) || min < 8 || min > 32)
    return { ok: false, message: "密码最小长度须为 8～32" };
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0 || maxAgeDays > 730)
    return { ok: false, message: "密码最长使用天数须为 0～730（0 表示不强制更换）" };
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
  const holdLegacy = Math.max(holdSale, holdRent);
  db.prepare(
    `UPDATE settings SET house_hold_limit=?, house_hold_limit_sale=?, house_hold_limit_rent=?, customer_hold_limit=?,
     manager_award_rate=?, agent_pool_rate=?,
     public_pool_days=?, deal_required_fields=?,
     password_min_length=?, password_max_age_days=?, deal_doc_required=?, house_role_protection_days=?,
     force_follow_before_phone=?, non_holder_view_remind=?,
     updated_by=?, updated_at=? WHERE company_id=?`
  ).run(
    holdLegacy,
    holdSale,
    holdRent,
    customerHold,
    award,
    agentPoolRate,
    publicPoolDays,
    JSON.stringify(p.deal_required_fields || []),
    min,
    maxAgeDays,
    p.deal_doc_required ? 1 : 0,
    protectionDays,
    forceFollow,
    nonHolderRemind,
    user.id,
    nowIso(),
    user.company_id
  );
  writeAudit(db, user, "settings.update", "settings", user.company_id, {
    password_max_age_days: maxAgeDays,
    agent_pool_rate: agentPoolRate,
    public_pool_days: publicPoolDays,
  });
  const recipients = db
    .prepare(
      `SELECT id, store_id FROM users WHERE company_id=? AND status='active'
       AND role IN ('admin', 'store_manager')`
    )
    .all(user.company_id) as any[];
  const body = `持盘上限 ${hold} · 管理奖 ${award} · 密码最短 ${min} · 角色保护 ${protectionDays} 天`;
  for (const recipient of recipients) {
    if (recipient.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: recipient.store_id,
      user_id: recipient.id,
      title: "业务参数已更新",
      body,
      kind: "business_record_status",
      ref_type: "settings",
      ref_id: user.company_id,
    });
  }
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
  const recipients = db
    .prepare(
      `SELECT id, store_id FROM users WHERE company_id=? AND status='active'
       AND role IN ('admin', 'store_manager')`
    )
    .all(user.company_id) as any[];
  for (const recipient of recipients) {
    if (recipient.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: recipient.store_id || user.store_id,
      user_id: recipient.id,
      title: "提成阶梯已创建",
      body: `金额 ${min}${max == null ? "+" : "～" + max} · 经纪人池 ${rate}`,
      kind: "business_record_status",
      ref_type: "commission_tier",
      ref_id: id,
    });
  }
  return { ok: true, data: { id } };
}
