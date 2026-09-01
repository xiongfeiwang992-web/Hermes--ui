import type { Db } from "../db/database";
import {
  canSeeOwnerPhone,
  canWriteListing,
  customerVisibleTo,
  houseVisibleTo,
} from "../auth/policy";
import { writeAudit } from "./audit";
import {
  isAllowedFollowMethod,
  normalizeFollowMethod,
  resolveFollowMethods,
} from "./config";
import { getContactGateSettings } from "./contactGate";
import { createMessage } from "./message";
import { nextId, nowIso, todayDate } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

export function createFollow(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  if (!payload.target_type || !payload.target_id || !payload.content) {
    return { ok: false, message: "跟进内容不完整" };
  }
  if (String(payload.content).trim().length < 5) {
    return { ok: false, message: "跟进内容至少 5 个字" };
  }
  const followKind = payload.follow_kind || "normal";
  if (!["normal", "price_change", "modification"].includes(followKind)) {
    return { ok: false, message: "跟进类型无效" };
  }
  const method = normalizeFollowMethod(payload.method || "other");
  if (!isAllowedFollowMethod(db, user.company_id, method)) {
    return { ok: false, message: "跟进方式不在当前字典中" };
  }
  if (payload.target_type === "house") {
    const house = db
      .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
      .get(payload.target_id, user.company_id) as any;
    if (!house || !houseVisibleTo(user, house)) {
      return { ok: false, message: "房源不可见", code: 403 };
    }
  } else if (payload.target_type === "customer") {
    const customer = db
      .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
      .get(payload.target_id, user.company_id) as any;
    if (!customer || !customerVisibleTo(user, customer)) {
      return { ok: false, message: "客源不可见", code: 403 };
    }
    if (customer.status === "new") {
      db.prepare(`UPDATE customers SET status = 'following', updated_at = ? WHERE id = ?`).run(
        nowIso(),
        customer.id
      );
    } else {
      db.prepare(`UPDATE customers SET updated_at = ? WHERE id = ?`).run(nowIso(), customer.id);
    }
  } else {
    return { ok: false, message: "target_type 无效" };
  }

  const id = nextId("FLW");
  db.prepare(
    `INSERT INTO follows(id, company_id, store_id, target_type, target_id, content, method,
     next_follow_at, created_by, voided, created_at, follow_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    payload.target_type,
    payload.target_id,
    payload.content.trim(),
    method,
    payload.next_follow_at || null,
    user.id,
    nowIso(),
    followKind
  );
  if (payload.target_type === "house") {
    db.prepare(`UPDATE houses SET updated_at = ? WHERE id = ?`).run(nowIso(), payload.target_id);
  }
  writeAudit(db, user, "follow.create", "follow", id);
  return { ok: true, data: { id } };
}

export type ModificationFieldDiff = {
  label: string;
  provided: boolean;
  prev: unknown;
  next: unknown;
  sensitive?: boolean;
  bool?: boolean;
};

function coerceDiffToken(value: unknown, asBool = false): string {
  if (value == null) return "";
  if (asBool || typeof value === "boolean") {
    if (value === true || value === 1 || value === "1") return "1";
    if (value === false || value === 0 || value === "0") return "0";
  }
  if (typeof value === "number") return String(value);
  return String(value).trim();
}

function displayDiffToken(value: unknown, asBool = false): string {
  const token = coerceDiffToken(value, asBool);
  if (!token) return "空";
  if (asBool) return token === "1" ? "是" : "否";
  return token;
}

/** Build a human-readable modification summary; null when nothing actually changed. */
export function buildModificationSummary(fields: ModificationFieldDiff[]): string | null {
  const parts: string[] = [];
  for (const field of fields) {
    if (!field.provided) continue;
    const prev = coerceDiffToken(field.prev, field.bool);
    const next = coerceDiffToken(field.next, field.bool);
    if (prev === next) continue;
    if (field.sensitive) {
      parts.push(`${field.label}已更新`);
    } else {
      parts.push(
        `${field.label} ${displayDiffToken(field.prev, field.bool)}→${displayDiffToken(field.next, field.bool)}`
      );
    }
  }
  if (!parts.length) return null;
  let summary = `修改：${parts.join("；")}`;
  if (summary.trim().length < 5) summary = `${summary}（资料已更新）`;
  return summary;
}

/** System-generated follow row for house/customer edits (does not mutate target status). */
export function recordModificationFollow(
  db: Db,
  user: SessionUser,
  input: {
    targetType: "house" | "customer";
    targetId: string;
    summary: string;
    followKind?: "modification" | "price_change";
  }
): void {
  const followKind = input.followKind || "modification";
  let content = String(input.summary || "").trim();
  if (content.length < 5) content = `${content}（资料已更新）`;
  const id = nextId("FLW");
  db.prepare(
    `INSERT INTO follows(id, company_id, store_id, target_type, target_id, content, method,
     next_follow_at, created_by, voided, created_at, follow_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    input.targetType,
    input.targetId,
    content,
    "other",
    null,
    user.id,
    nowIso(),
    followKind
  );
  writeAudit(db, user, "follow.create", "follow", id, { auto: followKind });
}

export function buildPriceChangeSummary(prev: unknown, next: unknown): string | null {
  const from = coerceDiffToken(prev);
  const to = coerceDiffToken(next);
  if (from === to) return null;
  return `改价：${displayDiffToken(prev)}→${displayDiffToken(next)}`;
}

export function revealContact(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  if (!payload.target_type || !payload.target_id || !payload.content) {
    return { ok: false, message: "须指定目标并填写跟进内容" };
  }
  if (!["house", "customer"].includes(payload.target_type)) {
    return { ok: false, message: "target_type 无效" };
  }
  const follow = createFollow(db, user, {
    target_type: payload.target_type,
    target_id: payload.target_id,
    content: payload.content,
    method: payload.method || "phone",
    next_follow_at: payload.next_follow_at || null,
    follow_kind: payload.follow_kind || "normal",
  });
  if (!follow.ok) return follow;

  if (payload.target_type === "house") {
    const house = db
      .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
      .get(payload.target_id, user.company_id) as any;
    if (!house || !houseVisibleTo(user, house)) {
      return { ok: false, message: "房源不可见", code: 403 };
    }
    if (!canSeeOwnerPhone(user, house)) {
      return { ok: false, message: "无权查看该业主电话", code: 403 };
    }
    writeAudit(db, user, "contact.reveal", "house", house.id, {
      follow_id: (follow.data as any).id,
    });
    return {
      ok: true,
      data: {
        target_type: "house",
        target_id: house.id,
        phone: house.owner_phone,
        follow_id: (follow.data as any).id,
      },
    };
  }

  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.target_id, user.company_id) as any;
  if (!customer || !customerVisibleTo(user, customer)) {
    return { ok: false, message: "客源不可见", code: 403 };
  }
  const canFull =
    user.role === "admin" ||
    user.role === "store_manager" ||
    user.id === customer.agent_id;
  if (!canFull) {
    return { ok: false, message: "无权查看该客户电话", code: 403 };
  }
  writeAudit(db, user, "contact.reveal", "customer", customer.id, {
    follow_id: (follow.data as any).id,
  });
  return {
    ok: true,
    data: {
      target_type: "customer",
      target_id: customer.id,
      phone: customer.phone,
      follow_id: (follow.data as any).id,
    },
  };
}

export function listFollows(db: Db, user: SessionUser, q: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT * FROM follows WHERE company_id = ? AND voided = 0 ORDER BY created_at DESC`
    )
    .all(user.company_id) as any[];
  if (user.role === "agent") {
    rows = rows.filter((f) => f.created_by === user.id || f.store_id === user.store_id);
  } else if (user.role === "store_manager") {
    rows = rows.filter((f) => f.store_id === user.store_id);
  }
  if (q.target_type) rows = rows.filter((f) => f.target_type === q.target_type);
  if (q.target_id) rows = rows.filter((f) => f.target_id === q.target_id);
  if (q.follow_kind) rows = rows.filter((f) => f.follow_kind === q.follow_kind);
  if (q.due === "today" || q.due === "overdue") {
    const today = todayDate();
    rows = rows.filter((f) => {
      if (!f.next_follow_at) return false;
      const d = String(f.next_follow_at).slice(0, 10);
      return q.due === "today" ? d === today : d < today;
    });
    if (user.role === "agent") rows = rows.filter((f) => f.created_by === user.id);
  }
  const labels = new Map(
    resolveFollowMethods(db, user.company_id).map((item) => [item.value, item.label])
  );
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      method_label: labels.get(row.method) || row.method || "",
    })),
  };
}

export function createView(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  if (!payload.customer_id || !payload.house_id || !payload.view_at) {
    return { ok: false, message: "带看须选择客户、房源与时间" };
  }
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.customer_id, user.company_id) as any;
  const house = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.house_id, user.company_id) as any;
  if (!customer || !customerVisibleTo(user, customer)) {
    return { ok: false, message: "客源不可见", code: 403 };
  }
  if (!house || !houseVisibleTo(user, house)) {
    return { ok: false, message: "房源不可见", code: 403 };
  }
  const id = nextId("VW");
  const now = nowIso();
  db.prepare(
    `INSERT INTO views(
      id, company_id, store_id, customer_id, house_id, view_at, agent_id, accompany_ids,
      feedback, content, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'planned', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    payload.customer_id,
    payload.house_id,
    payload.view_at,
    payload.agent_id || user.id,
    JSON.stringify(payload.accompany_ids || []),
    payload.content || null,
    user.id,
    now,
    now
  );
  if (["new", "following"].includes(customer.status)) {
    db.prepare(`UPDATE customers SET status = 'viewing', updated_at = ? WHERE id = ?`).run(
      now,
      customer.id
    );
  }
  const viewerId = payload.agent_id || user.id;
  const gate = getContactGateSettings(db, user.company_id);
  if (gate.non_holder_view_remind && house.agent_id && house.agent_id !== viewerId) {
    const viewer = db
      .prepare(`SELECT display_name FROM users WHERE id = ? AND company_id = ?`)
      .get(viewerId, user.company_id) as { display_name?: string } | undefined;
    createMessage(db, {
      company_id: user.company_id,
      store_id: house.store_id,
      user_id: house.agent_id,
      title: "非接盘人带看提醒",
      body: `${viewer?.display_name || "同事"} 登记了您盘源「${house.title}」的带看`,
      kind: "view_non_holder",
      ref_type: "view",
      ref_id: id,
    });
  }
  writeAudit(db, user, "view.create", "view", id);
  return getView(db, user, id);
}

export function getView(db: Db, user: SessionUser, id: string): ApiResult {
  const row = db
    .prepare(`SELECT * FROM views WHERE id = ? AND company_id = ?`)
    .get(id, user.company_id) as any;
  if (!row) return { ok: false, message: "带看不存在" };
  if (user.role === "agent" && row.agent_id !== user.id && row.store_id !== user.store_id) {
    return { ok: false, message: "无权限", code: 403 };
  }
  if (user.role === "store_manager" && row.store_id !== user.store_id) {
    return { ok: false, message: "无权限", code: 403 };
  }
  return {
    ok: true,
    data: {
      ...row,
      accompany_ids: JSON.parse(row.accompany_ids || "[]"),
    },
  };
}

export function listViews(db: Db, user: SessionUser, q: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(`SELECT * FROM views WHERE company_id = ? ORDER BY view_at DESC`)
    .all(user.company_id) as any[];
  if (user.role === "agent") rows = rows.filter((v) => v.store_id === user.store_id);
  if (user.role === "store_manager") rows = rows.filter((v) => v.store_id === user.store_id);
  if (q.agent_id) rows = rows.filter((v) => v.agent_id === q.agent_id);
  if (q.status) rows = rows.filter((v) => v.status === q.status);
  if (q.feedback) rows = rows.filter((v) => v.feedback === q.feedback);
  if (q.customer_id) rows = rows.filter((v) => v.customer_id === q.customer_id);
  if (q.house_id) rows = rows.filter((v) => v.house_id === q.house_id);
  return {
    ok: true,
    data: rows.map((r) => ({ ...r, accompany_ids: JSON.parse(r.accompany_ids || "[]") })),
  };
}

function parseAccompanyIds(raw: unknown): string[] {
  let ids: string[] = [];
  try {
    ids = typeof raw === "string" ? JSON.parse(raw || "[]") : Array.isArray(raw) ? raw : [];
  } catch {
    ids = [];
  }
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && Boolean(id));
}

function notifyViewStakeholders(
  db: Db,
  user: SessionUser,
  view: any,
  title: string,
  body: string
): void {
  const house = db
    .prepare(`SELECT id, title, agent_id, store_id FROM houses WHERE id = ? AND company_id = ?`)
    .get(view.house_id, user.company_id) as
    | { id: string; title?: string; agent_id?: string; store_id?: string }
    | undefined;
  const customer = db
    .prepare(`SELECT id, name, agent_id FROM customers WHERE id = ? AND company_id = ?`)
    .get(view.customer_id, user.company_id) as
    | { id: string; name?: string; agent_id?: string }
    | undefined;
  const recipients = new Set<string>();
  if (house?.agent_id) recipients.add(house.agent_id);
  if (view.agent_id) recipients.add(view.agent_id);
  if (customer?.agent_id) recipients.add(customer.agent_id);
  for (const accompanyId of parseAccompanyIds(view.accompany_ids)) {
    recipients.add(accompanyId);
  }
  recipients.delete(user.id);
  for (const userId of recipients) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: view.store_id || house?.store_id || user.store_id,
      user_id: userId,
      title,
      body,
      kind: "view_non_holder",
      ref_type: "view",
      ref_id: view.id,
    });
  }
}

export function completeView(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM views WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current) return { ok: false, message: "带看不存在" };
  if (current.status !== "planned") return { ok: false, message: "带看已结束" };
  if (user.role === "agent" && current.agent_id !== user.id) {
    return { ok: false, message: "只能完成本人主看带看", code: 403 };
  }
  if (!payload.feedback || payload.feedback === "pending") {
    return { ok: false, message: "完成前须选择反馈结果" };
  }
  db.prepare(
    `UPDATE views SET feedback = ?, content = COALESCE(?, content), status = 'done', updated_at = ? WHERE id = ?`
  ).run(payload.feedback, payload.content || null, nowIso(), payload.id);
  writeAudit(db, user, "view.complete", "view", payload.id, { feedback: payload.feedback });
  const house = db
    .prepare(`SELECT title FROM houses WHERE id = ? AND company_id = ?`)
    .get(current.house_id, user.company_id) as { title?: string } | undefined;
  const customer = db
    .prepare(`SELECT name FROM customers WHERE id = ? AND company_id = ?`)
    .get(current.customer_id, user.company_id) as { name?: string } | undefined;
  notifyViewStakeholders(
    db,
    user,
    current,
    "带看已完成",
    `${house?.title || "房源"} · 客户 ${customer?.name || "-"} · 反馈 ${payload.feedback}`
  );
  return getView(db, user, payload.id);
}

export function cancelView(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM views WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current) return { ok: false, message: "带看不存在" };
  if (current.status !== "planned") return { ok: false, message: "带看已结束" };
  if (!payload.reason) return { ok: false, message: "取消须填写原因" };
  const reason = String(payload.reason).trim();
  if (!reason) return { ok: false, message: "取消须填写原因" };
  db.prepare(
    `UPDATE views SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?`
  ).run(reason, nowIso(), payload.id);
  writeAudit(db, user, "view.cancel", "view", payload.id, { reason });
  const house = db
    .prepare(`SELECT title FROM houses WHERE id = ? AND company_id = ?`)
    .get(current.house_id, user.company_id) as { title?: string } | undefined;
  const customer = db
    .prepare(`SELECT name FROM customers WHERE id = ? AND company_id = ?`)
    .get(current.customer_id, user.company_id) as { name?: string } | undefined;
  notifyViewStakeholders(
    db,
    user,
    current,
    "带看已取消",
    `${house?.title || "房源"} · 客户 ${customer?.name || "-"} · ${reason}`
  );
  return getView(db, user, payload.id);
}

export function notifyFollowDue(db: Db, user: SessionUser): void {
  const today = todayDate();
  const rows = db
    .prepare(
      `SELECT * FROM follows WHERE company_id = ? AND created_by = ? AND voided = 0
       AND next_follow_at IS NOT NULL AND substr(next_follow_at,1,10) <= ?`
    )
    .all(user.company_id, user.id, today) as any[];
  if (rows.length) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: user.store_id,
      user_id: user.id,
      title: "待跟进提醒",
      body: `您有 ${rows.length} 条待跟进/逾期跟进`,
      kind: "follow_due",
    });
  }
}
