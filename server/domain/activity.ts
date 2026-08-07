import type { Db } from "../db/database";
import { canWriteListing, customerVisibleTo, houseVisibleTo } from "../auth/policy";
import { writeAudit } from "./audit";
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
    `INSERT INTO follows(id, company_id, store_id, target_type, target_id, content, method, next_follow_at, created_by, voided, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    payload.target_type,
    payload.target_id,
    payload.content.trim(),
    payload.method || "other",
    payload.next_follow_at || null,
    user.id,
    nowIso()
  );
  if (payload.target_type === "house") {
    db.prepare(`UPDATE houses SET updated_at = ? WHERE id = ?`).run(nowIso(), payload.target_id);
  }
  writeAudit(db, user, "follow.create", "follow", id);
  return { ok: true, data: { id } };
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
  if (q.due === "today" || q.due === "overdue") {
    const today = todayDate();
    rows = rows.filter((f) => {
      if (!f.next_follow_at) return false;
      const d = String(f.next_follow_at).slice(0, 10);
      return q.due === "today" ? d === today : d < today;
    });
    if (user.role === "agent") rows = rows.filter((f) => f.created_by === user.id);
  }
  return { ok: true, data: rows };
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
  db.prepare(
    `UPDATE views SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?`
  ).run(payload.reason, nowIso(), payload.id);
  writeAudit(db, user, "view.cancel", "view", payload.id, { reason: payload.reason });
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
