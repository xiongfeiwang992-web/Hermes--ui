import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const METRICS = new Set(["commission", "deals"]);
const ROLES = new Set(["agent", "store_manager", "finance", "admin"]);

function canManage(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "store_manager";
}

function validMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function money(value: number): number {
  return Math.round(Number(value) * 100) / 100;
}

function addEvent(
  db: Db,
  user: SessionUser,
  entityType: string,
  entityId: string,
  eventType: string,
  details: unknown = {}
) {
  db.prepare(
    `INSERT INTO performance_events(
      id, company_id, entity_type, entity_id, event_type, details, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("PFE"),
    user.company_id,
    entityType,
    entityId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function monthRange(periodMonth: string): { start: string; end: string } {
  const [year, month] = periodMonth.split("-").map(Number);
  const start = `${periodMonth}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${periodMonth}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function actualForTarget(db: Db, target: any): number {
  const { start, end } = monthRange(target.period_month);
  const deals = db
    .prepare(
      `SELECT commission_total, agent_ids, split_ratios FROM deals
       WHERE company_id=? AND store_id=? AND status='approved'
         AND deal_date BETWEEN ? AND ?`
    )
    .all(target.company_id, target.store_id, start, end) as any[];
  if (target.metric === "deals") {
    if (!target.user_id) return deals.length;
    return deals.filter((deal) =>
      (JSON.parse(deal.agent_ids || "[]") as string[]).includes(target.user_id)
    ).length;
  }
  if (!target.user_id) {
    return money(deals.reduce((sum, deal) => sum + Number(deal.commission_total), 0));
  }
  return money(
    deals.reduce((sum, deal) => {
      const agents = JSON.parse(deal.agent_ids || "[]") as string[];
      if (!agents.includes(target.user_id)) return sum;
      const ratios = JSON.parse(deal.split_ratios || "{}") as Record<string, number>;
      const ratio = Number(ratios[target.user_id] || 0);
      return sum + Number(deal.commission_total) * (ratio / 100);
    }, 0)
  );
}

export function performanceOptions(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance")
    return { ok: true, data: { stores: [], users: [], rules: [] } };
  let stores = db
    .prepare(`SELECT id, name FROM stores WHERE company_id=? AND status='active' ORDER BY name`)
    .all(user.company_id) as any[];
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  let rules = db
    .prepare(
      `SELECT id, code, name, points, applicable_role FROM performance_point_rules
       WHERE company_id=? AND status='active' ORDER BY name`
    )
    .all(user.company_id) as any[];
  if (user.role !== "admin") {
    stores = stores.filter((store) => store.id === user.store_id);
    users = users.filter((row) => row.store_id === user.store_id);
  }
  if (user.role === "agent") {
    users = users.filter((row) => row.id === user.id);
    rules = rules.filter(
      (rule) => !rule.applicable_role || rule.applicable_role === user.role
    );
  }
  return { ok: true, data: { stores, users, rules } };
}

export function listPointRules(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance") return { ok: true, data: [] };
  const rows = db
    .prepare(
      `SELECT * FROM performance_point_rules WHERE company_id=? ORDER BY updated_at DESC`
    )
    .all(user.company_id);
  return { ok: true, data: rows };
}

export function savePointRule(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可维护积分规则", code: 403 };
  const code = String(payload.code || "").trim();
  const name = String(payload.name || "").trim();
  const points = Number(payload.points);
  if (!code || !name) return { ok: false, message: "规则代码和名称必填" };
  if (!Number.isFinite(points) || points === 0) return { ok: false, message: "积分值不能为 0" };
  if (payload.applicable_role && !ROLES.has(payload.applicable_role))
    return { ok: false, message: "适用角色无效" };
  const now = nowIso();
  if (payload.id) {
    const current = db
      .prepare(`SELECT * FROM performance_point_rules WHERE id=? AND company_id=?`)
      .get(payload.id, user.company_id) as any;
    if (!current) return { ok: false, message: "积分规则不存在", code: 404 };
    try {
      db.prepare(
        `UPDATE performance_point_rules SET code=?, name=?, points=?,
         applicable_role=?, status=?, updated_at=? WHERE id=?`
      ).run(
        code,
        name,
        points,
        payload.applicable_role || null,
        payload.status === "inactive" ? "inactive" : "active",
        now,
        current.id
      );
    } catch {
      return { ok: false, message: "规则代码已存在" };
    }
    addEvent(db, user, "point_rule", current.id, "updated");
    writeAudit(db, user, "performance.point_rule.update", "performance_point_rule", current.id);
    return { ok: true, data: { id: current.id } };
  }
  const id = nextId("PFR");
  try {
    db.prepare(
      `INSERT INTO performance_point_rules(
        id, company_id, code, name, points, applicable_role, status,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      code,
      name,
      points,
      payload.applicable_role || null,
      user.id,
      now,
      now
    );
  } catch {
    return { ok: false, message: "规则代码已存在" };
  }
  addEvent(db, user, "point_rule", id, "created");
  writeAudit(db, user, "performance.point_rule.create", "performance_point_rule", id);
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
      title: "积分规则已创建",
      body: `${name}（${code}）· ${points} 分`,
      kind: "performance",
      ref_type: "performance_point_rule",
      ref_id: id,
    });
  }
  return { ok: true, data: { id } };
}

export function listPointEntries(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT e.*, u.display_name, u.role, s.name AS store_name,
       r.name AS rule_name, creator.display_name AS creator_name
       FROM performance_point_entries e
       JOIN users u ON u.id=e.user_id
       JOIN stores s ON s.id=e.store_id
       LEFT JOIN performance_point_rules r ON r.id=e.rule_id
       JOIN users creator ON creator.id=e.created_by
       WHERE e.company_id=? ORDER BY e.updated_at DESC`
    )
    .all(user.company_id) as any[];
  if (user.role === "agent") rows = rows.filter((row) => row.user_id === user.id);
  else if (user.role === "store_manager")
    rows = rows.filter((row) => row.store_id === user.store_id);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.user_id) rows = rows.filter((row) => row.user_id === payload.user_id);
  const balance = money(
    rows
      .filter((row) => row.status === "approved")
      .reduce((sum, row) => sum + Number(row.points), 0)
  );
  return { ok: true, data: { entries: rows, balance } };
}

export function createPointEntry(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无积分录入权限", code: 403 };
  const target = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.user_id, user.company_id) as any;
  if (!target) return { ok: false, message: "积分对象不存在" };
  if (user.role === "store_manager" && target.store_id !== user.store_id)
    return { ok: false, message: "只能为本店员工录入积分", code: 403 };
  let points = Number(payload.points);
  let ruleId: string | null = null;
  if (payload.rule_id) {
    const rule = db
      .prepare(
        `SELECT * FROM performance_point_rules WHERE id=? AND company_id=? AND status='active'`
      )
      .get(payload.rule_id, user.company_id) as any;
    if (!rule) return { ok: false, message: "积分规则不存在或已停用" };
    if (rule.applicable_role && rule.applicable_role !== target.role)
      return { ok: false, message: "积分规则不适用该员工角色" };
    points = Number(rule.points);
    ruleId = rule.id;
  }
  if (!Number.isFinite(points) || points === 0) return { ok: false, message: "积分值无效" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "积分原因必填" };
  const id = nextId("PFP");
  const now = nowIso();
  const status = user.role === "admin" ? "approved" : "pending";
  db.prepare(
    `INSERT INTO performance_point_entries(
      id, company_id, store_id, user_id, rule_id, points, reason, status,
      reviewed_by, reviewed_at, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    target.store_id,
    target.id,
    ruleId,
    points,
    reason,
    status,
    status === "approved" ? user.id : null,
    status === "approved" ? now : null,
    user.id,
    now,
    now
  );
  addEvent(db, user, "point_entry", id, status === "approved" ? "approved" : "created");
  if (status === "pending") {
    const admins = db
      .prepare(`SELECT id FROM users WHERE company_id=? AND role='admin' AND status='active'`)
      .all(user.company_id) as any[];
    for (const admin of admins) {
      createMessage(db, {
        company_id: user.company_id,
        store_id: target.store_id,
        user_id: admin.id,
        title: "积分待审批",
        body: `${target.display_name} ${points > 0 ? "+" : ""}${points}：${reason}`,
        kind: "performance",
        ref_type: "performance_point_entry",
        ref_id: id,
      });
    }
  } else if (target.id !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: target.store_id,
      user_id: target.id,
      title: "积分已入账",
      body: `${points > 0 ? "+" : ""}${points}：${reason}`,
      kind: "performance",
      ref_type: "performance_point_entry",
      ref_id: id,
    });
  }
  writeAudit(db, user, "performance.point_entry.create", "performance_point_entry", id);
  return { ok: true, data: { id, status } };
}

export function reviewPointEntry(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可审批积分", code: 403 };
  const row = db
    .prepare(`SELECT * FROM performance_point_entries WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.status !== "pending")
    return { ok: false, message: "积分记录不存在或不可审批" };
  if (!["approved", "rejected"].includes(payload.status))
    return { ok: false, message: "审批结果无效" };
  const reason = String(payload.reject_reason || "").trim();
  if (payload.status === "rejected" && !reason)
    return { ok: false, message: "驳回原因必填" };
  const now = nowIso();
  db.prepare(
    `UPDATE performance_point_entries SET status=?, reviewed_by=?, reviewed_at=?,
     reject_reason=?, updated_at=? WHERE id=?`
  ).run(
    payload.status,
    user.id,
    now,
    payload.status === "rejected" ? reason : null,
    now,
    row.id
  );
  addEvent(db, user, "point_entry", row.id, payload.status, {
    reject_reason: payload.status === "rejected" ? reason : null,
  });
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.user_id,
    title: payload.status === "approved" ? "积分审批通过" : "积分审批驳回",
    body: row.reason,
    kind: "performance",
    ref_type: "performance_point_entry",
    ref_id: row.id,
  });
  writeAudit(db, user, `performance.point_entry.${payload.status}`, "performance_point_entry", row.id);
  return { ok: true, data: { id: row.id, status: payload.status } };
}

export function listTargets(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT t.*, s.name AS store_name, u.display_name AS user_name
       FROM performance_targets t
       JOIN stores s ON s.id=t.store_id
       LEFT JOIN users u ON u.id=t.user_id
       WHERE t.company_id=? ORDER BY t.period_month DESC, t.updated_at DESC`
    )
    .all(user.company_id) as any[];
  if (user.role === "agent")
    rows = rows.filter(
      (row) =>
        (row.user_id && row.user_id === user.id) ||
        (!row.user_id && row.store_id === user.store_id)
    );
  else if (user.role === "store_manager")
    rows = rows.filter((row) => row.store_id === user.store_id);
  else if (user.role === "finance") rows = rows.filter(() => true);
  if (payload.period_month)
    rows = rows.filter((row) => row.period_month === payload.period_month);
  const data = rows.map((row) => {
    const actual = actualForTarget(db, row);
    return {
      ...row,
      actual_value: actual,
      completion_rate:
        Number(row.target_value) > 0
          ? money((actual / Number(row.target_value)) * 100)
          : 0,
    };
  });
  return { ok: true, data };
}

export function saveTarget(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无业绩目标维护权限", code: 403 };
  if (!validMonth(payload.period_month)) return { ok: false, message: "目标月份无效" };
  if (!METRICS.has(payload.metric)) return { ok: false, message: "目标指标无效" };
  const targetValue = Number(payload.target_value);
  if (!Number.isFinite(targetValue) || targetValue <= 0)
    return { ok: false, message: "目标值必须大于 0" };
  let storeId = user.role === "admin" ? payload.store_id || user.store_id : user.store_id;
  const store = db
    .prepare(`SELECT id FROM stores WHERE id=? AND company_id=? AND status='active'`)
    .get(storeId, user.company_id);
  if (!store) return { ok: false, message: "目标门店无效" };
  let userId: string | null = null;
  if (payload.user_id) {
    const employee = db
      .prepare(
        `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=? AND status='active'`
      )
      .get(payload.user_id, user.company_id, storeId);
    if (!employee) return { ok: false, message: "目标员工必须为同店在职人员" };
    userId = payload.user_id;
  }
  const id = nextId("PFT");
  const now = nowIso();
  try {
    db.prepare(
      `INSERT INTO performance_targets(
        id, company_id, store_id, user_id, period_month, metric, target_value,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      storeId,
      userId,
      payload.period_month,
      payload.metric,
      targetValue,
      user.id,
      now,
      now
    );
  } catch {
    return { ok: false, message: "同范围目标已存在" };
  }
  addEvent(db, user, "target", id, "created");
  writeAudit(db, user, "performance.target.create", "performance_target", id);
  return { ok: true, data: { id } };
}

export function listBonusBatches(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT b.*, s.name AS store_name FROM performance_bonus_batches b
       JOIN stores s ON s.id=b.store_id
       WHERE b.company_id=? ORDER BY b.period_month DESC`
    )
    .all(user.company_id) as any[];
  if (user.role === "store_manager")
    rows = rows.filter((row) => row.store_id === user.store_id);
  else if (user.role === "agent") rows = [];
  if (payload.period_month)
    rows = rows.filter((row) => row.period_month === payload.period_month);
  return { ok: true, data: rows };
}

export function createBonusBatch(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "finance"))
    return { ok: false, message: "仅管理员或财务可生成管理奖", code: 403 };
  if (!validMonth(payload.period_month)) return { ok: false, message: "管理奖月份无效" };
  const store = db
    .prepare(`SELECT id FROM stores WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.store_id, user.company_id);
  if (!store) return { ok: false, message: "管理奖门店无效" };
  const settings = db
    .prepare(`SELECT manager_award_rate FROM settings WHERE company_id=?`)
    .get(user.company_id) as any;
  const awardRate = Number(payload.award_rate ?? settings?.manager_award_rate ?? 0);
  if (!Number.isFinite(awardRate) || awardRate <= 0 || awardRate > 1)
    return { ok: false, message: "管理奖比例无效" };
  const managers = db
    .prepare(
      `SELECT id, display_name FROM users WHERE company_id=? AND store_id=?
       AND role='store_manager' AND status='active'`
    )
    .all(user.company_id, payload.store_id) as any[];
  if (!managers.length) return { ok: false, message: "该门店没有在职店长" };
  const { start, end } = monthRange(payload.period_month);
  const base = db
    .prepare(
      `SELECT COALESCE(SUM(commission_total),0) AS s FROM deals
       WHERE company_id=? AND store_id=? AND status='approved'
         AND deal_date BETWEEN ? AND ?`
    )
    .get(user.company_id, payload.store_id, start, end) as any;
  const commissionBase = money(Number(base?.s || 0));
  const bonusTotal = money(commissionBase * awardRate);
  if (bonusTotal <= 0) return { ok: false, message: "当月无可分配管理奖基数" };
  const perManager = money(bonusTotal / managers.length);
  const id = nextId("PFB");
  const now = nowIso();
  try {
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO performance_bonus_batches(
          id, company_id, store_id, period_month, award_rate, commission_base,
          bonus_total, status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'calculated', ?, ?, ?)`
      ).run(
        id,
        user.company_id,
        payload.store_id,
        payload.period_month,
        awardRate,
        commissionBase,
        bonusTotal,
        user.id,
        now,
        now
      );
      for (const manager of managers) {
        db.prepare(
          `INSERT INTO performance_bonus_items(
            id, company_id, batch_id, user_id, amount, note
          ) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          nextId("PFI"),
          user.company_id,
          id,
          manager.id,
          perManager,
          "店长管理奖均分"
        );
      }
      addEvent(db, user, "bonus_batch", id, "calculated", {
        managers: managers.length,
        bonus_total: bonusTotal,
      });
    });
    tx();
  } catch {
    return { ok: false, message: "该门店当月管理奖批次已存在" };
  }
  writeAudit(db, user, "performance.bonus.create", "performance_bonus_batch", id);
  return { ok: true, data: { id, status: "calculated", bonus_total: bonusTotal } };
}

export function listBonusItems(db: Db, user: SessionUser, payload: any): ApiResult {
  const batch = db
    .prepare(`SELECT * FROM performance_bonus_batches WHERE id=? AND company_id=?`)
    .get(payload.batch_id, user.company_id) as any;
  if (!batch) return { ok: false, message: "管理奖批次不存在", code: 404 };
  if (
    user.role === "store_manager" &&
    batch.store_id !== user.store_id
  )
    return { ok: false, message: "无权限查看该管理奖批次", code: 403 };
  if (user.role === "agent") return { ok: false, message: "经纪人不可查看管理奖明细", code: 403 };
  let rows = db
    .prepare(
      `SELECT i.*, u.display_name, u.role FROM performance_bonus_items i
       JOIN users u ON u.id=i.user_id WHERE i.batch_id=? ORDER BY u.display_name`
    )
    .all(batch.id) as any[];
  if (user.role === "store_manager")
    rows = rows.filter((row) => row.user_id === user.id);
  return { ok: true, data: rows };
}

export function payBonusBatch(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "finance" && user.role !== "admin")
    return { ok: false, message: "仅财务或管理员可登记管理奖发放", code: 403 };
  const batch = db
    .prepare(`SELECT * FROM performance_bonus_batches WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!batch || batch.status !== "calculated")
    return { ok: false, message: "管理奖批次不存在或不可发放" };
  const reference = String(payload.payment_reference || "").trim();
  if (!reference) return { ok: false, message: "发奖流水号必填" };
  const now = nowIso();
  db.prepare(
    `UPDATE performance_bonus_batches SET status='paid', paid_by=?, paid_at=?,
     payment_reference=?, updated_at=? WHERE id=?`
  ).run(user.id, now, reference, now, batch.id);
  const items = db
    .prepare(`SELECT user_id, amount FROM performance_bonus_items WHERE batch_id=?`)
    .all(batch.id) as any[];
  for (const item of items) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: batch.store_id,
      user_id: item.user_id,
      title: "管理奖已发放",
      body: `${batch.period_month} 管理奖 ¥${item.amount}`,
      kind: "performance",
      ref_type: "performance_bonus_batch",
      ref_id: batch.id,
    });
  }
  addEvent(db, user, "bonus_batch", batch.id, "paid", { payment_reference: reference });
  writeAudit(db, user, "performance.bonus.pay", "performance_bonus_batch", batch.id);
  return { ok: true, data: { id: batch.id, status: "paid" } };
}

export function listDividendBatches(db: Db, user: SessionUser): ApiResult {
  let rows = db
    .prepare(
      `SELECT * FROM performance_dividend_batches WHERE company_id=?
       ORDER BY period_month DESC`
    )
    .all(user.company_id) as any[];
  if (user.role === "agent" || user.role === "store_manager") {
    const own = db
      .prepare(
        `SELECT DISTINCT batch_id FROM performance_dividend_items
         WHERE company_id=? AND user_id=?`
      )
      .all(user.company_id, user.id) as any[];
    const ids = new Set(own.map((row) => row.batch_id));
    rows = rows.filter((row) => row.status === "paid" && ids.has(row.id));
  }
  return { ok: true, data: rows };
}

export function createDividendBatch(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可创建分红批次", code: 403 };
  if (!validMonth(payload.period_month)) return { ok: false, message: "分红月份无效" };
  const pool = money(Number(payload.pool_amount));
  if (!Number.isFinite(pool) || pool <= 0) return { ok: false, message: "分红池金额无效" };
  const { start, end } = monthRange(payload.period_month);
  const points = db
    .prepare(
      `SELECT user_id, store_id, SUM(points) AS points FROM performance_point_entries
       WHERE company_id=? AND status='approved'
         AND date(created_at) BETWEEN ? AND ?
       GROUP BY user_id, store_id HAVING SUM(points) > 0`
    )
    .all(user.company_id, start, end) as any[];
  if (!points.length) return { ok: false, message: "当月没有可参与分红的有效积分" };
  const totalPoints = money(points.reduce((sum, row) => sum + Number(row.points), 0));
  const id = nextId("PFD");
  const now = nowIso();
  try {
    const tx = db.transaction(() => {
      let allocated = 0;
      const shares = points.map((row, index) => {
        const amount =
          index === points.length - 1
            ? money(pool - allocated)
            : money((Number(row.points) / totalPoints) * pool);
        allocated = money(allocated + amount);
        return { ...row, share_amount: amount };
      });
      db.prepare(
        `INSERT INTO performance_dividend_batches(
          id, company_id, period_month, pool_amount, status, total_points,
          allocated_total, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'calculated', ?, ?, ?, ?, ?)`
      ).run(id, user.company_id, payload.period_month, pool, totalPoints, pool, user.id, now, now);
      for (const share of shares) {
        db.prepare(
          `INSERT INTO performance_dividend_items(
            id, company_id, batch_id, user_id, store_id, points, share_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          nextId("PFDI"),
          user.company_id,
          id,
          share.user_id,
          share.store_id,
          share.points,
          share.share_amount
        );
      }
      addEvent(db, user, "dividend_batch", id, "calculated", {
        total_points: totalPoints,
        pool_amount: pool,
      });
    });
    tx();
  } catch {
    return { ok: false, message: "该月分红批次已存在" };
  }
  writeAudit(db, user, "performance.dividend.create", "performance_dividend_batch", id);
  return { ok: true, data: { id, status: "calculated", total_points: totalPoints } };
}

export function listDividendItems(db: Db, user: SessionUser, payload: any): ApiResult {
  const batch = db
    .prepare(`SELECT * FROM performance_dividend_batches WHERE id=? AND company_id=?`)
    .get(payload.batch_id, user.company_id) as any;
  if (!batch) return { ok: false, message: "分红批次不存在", code: 404 };
  let rows = db
    .prepare(
      `SELECT i.*, u.display_name, s.name AS store_name FROM performance_dividend_items i
       JOIN users u ON u.id=i.user_id
       JOIN stores s ON s.id=i.store_id
       WHERE i.batch_id=? ORDER BY i.share_amount DESC`
    )
    .all(batch.id) as any[];
  if (user.role === "agent" || user.role === "store_manager") {
    if (batch.status !== "paid")
      return { ok: false, message: "分红明细仅发放后可见", code: 403 };
    rows = rows.filter((row) => row.user_id === user.id);
  }
  return { ok: true, data: rows };
}

export function payDividendBatch(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "finance" && user.role !== "admin")
    return { ok: false, message: "仅财务或管理员可登记分红发放", code: 403 };
  const batch = db
    .prepare(`SELECT * FROM performance_dividend_batches WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!batch || batch.status !== "calculated")
    return { ok: false, message: "分红批次不存在或不可发放" };
  const reference = String(payload.payment_reference || "").trim();
  if (!reference) return { ok: false, message: "分红流水号必填" };
  const now = nowIso();
  db.prepare(
    `UPDATE performance_dividend_batches SET status='paid', paid_by=?, paid_at=?,
     payment_reference=?, updated_at=? WHERE id=?`
  ).run(user.id, now, reference, now, batch.id);
  const items = db
    .prepare(`SELECT user_id, store_id, share_amount FROM performance_dividend_items WHERE batch_id=?`)
    .all(batch.id) as any[];
  for (const item of items) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: item.store_id,
      user_id: item.user_id,
      title: "利润分红已发放",
      body: `${batch.period_month} 分红 ¥${item.share_amount}`,
      kind: "performance",
      ref_type: "performance_dividend_batch",
      ref_id: batch.id,
    });
  }
  addEvent(db, user, "dividend_batch", batch.id, "paid", { payment_reference: reference });
  writeAudit(db, user, "performance.dividend.pay", "performance_dividend_batch", batch.id);
  return { ok: true, data: { id: batch.id, status: "paid" } };
}

export function listPerformanceEvents(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  if (!["point_entry", "target", "bonus_batch", "dividend_batch", "point_rule"].includes(payload.entity_type))
    return { ok: false, message: "履历对象类型无效" };
  if (user.role === "agent" && payload.entity_type !== "point_entry")
    return { ok: false, message: "无履历查看权限", code: 403 };
  if (payload.entity_type === "point_entry") {
    const row = db
      .prepare(`SELECT * FROM performance_point_entries WHERE id=? AND company_id=?`)
      .get(payload.entity_id, user.company_id) as any;
    if (
      !row ||
      (user.role === "agent" && row.user_id !== user.id) ||
      (user.role === "store_manager" && row.store_id !== user.store_id)
    )
      return { ok: false, message: "履历对象不存在或无权限", code: 403 };
  }
  const events = db
    .prepare(
      `SELECT e.*, u.display_name AS created_by_name FROM performance_events e
       JOIN users u ON u.id=e.created_by
       WHERE e.company_id=? AND e.entity_type=? AND e.entity_id=?
       ORDER BY e.created_at DESC`
    )
    .all(user.company_id, payload.entity_type, payload.entity_id);
  return { ok: true, data: events };
}
