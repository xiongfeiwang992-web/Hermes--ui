import type { Db } from "../db/database";
import { listFollows, listViews } from "./activity";
import { listHouses } from "./house";
import { listCustomers } from "./customer";
import { writeAudit } from "./audit";
import type { ApiResult, SessionUser } from "../utils/types";
import { todayDate } from "../utils/id";

export function dashboard(db: Db, user: SessionUser): ApiResult {
  const today = todayDate();
  const houses = db
    .prepare(`SELECT * FROM houses WHERE company_id = ?`)
    .all(user.company_id) as any[];
  const customers = db
    .prepare(`SELECT * FROM customers WHERE company_id = ?`)
    .all(user.company_id) as any[];
  const deals = db
    .prepare(`SELECT * FROM deals WHERE company_id = ?`)
    .all(user.company_id) as any[];
  const views = db
    .prepare(`SELECT * FROM views WHERE company_id = ?`)
    .all(user.company_id) as any[];

  const inStore = (storeId: string) =>
    user.role === "admin" || user.role === "finance" ? true : storeId === user.store_id;

  const availableHouses = houses.filter(
    (h) => h.status === "available" && inStore(h.store_id)
  ).length;
  const privateCustomers = customers.filter(
    (c) =>
      c.visibility === "private" &&
      inStore(c.store_id) &&
      (user.role !== "agent" || c.agent_id === user.id)
  ).length;
  const publicCustomers = customers.filter(
    (c) => c.visibility === "public" && inStore(c.store_id)
  ).length;
  const pendingDeals = deals.filter(
    (d) => d.status === "pending_approval" && inStore(d.store_id)
  ).length;
  const todayViews = views.filter(
    (v) => String(v.view_at).slice(0, 10) === today && inStore(v.store_id)
  ).length;

  const follows = listFollows(db, user, { due: "today" });
  const overdue = listFollows(db, user, { due: "overdue" });

  const approved = deals.filter((d) => d.status === "approved" && inStore(d.store_id));
  const commissionSum = approved.reduce((s, d) => s + Number(d.commission_total), 0);
  let paidSum = 0;
  for (const d of approved) {
    const paid = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS s FROM payments WHERE deal_id = ? AND status = 'confirmed'`
      )
      .get(d.id) as { s: number };
    paidSum += paid.s;
  }

  return {
    ok: true,
    data: {
      available_houses: availableHouses,
      private_customers: privateCustomers,
      public_customers: publicCustomers,
      pending_deals: pendingDeals,
      today_views: todayViews,
      follow_today: follows.ok ? (follows.data as any[]).length : 0,
      follow_overdue: overdue.ok ? (overdue.data as any[]).length : 0,
      commission_total: commissionSum,
      paid_total: paidSum,
      unpaid_total: commissionSum - paidSum,
    },
  };
}

function monthRange(month?: string): { month: string; start: string; end: string } {
  const normalized = /^\d{4}-\d{2}$/.test(month || "")
    ? month!
    : new Date().toISOString().slice(0, 7);
  const [year, value] = normalized.split("-").map(Number);
  const start = `${normalized}-01T00:00:00.000Z`;
  const end = new Date(Date.UTC(year, value, 1)).toISOString();
  return { month: normalized, start, end };
}

function scoped(user: SessionUser, row: any): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  return row.store_id === user.store_id;
}

export function businessSummary(
  db: Db,
  user: SessionUser,
  payload: { month?: string } = {}
): ApiResult {
  const range = monthRange(payload.month);
  const inMonth = (value: string | null | undefined) =>
    Boolean(value && value >= range.start && value < range.end);

  const houses = (
    db.prepare(`SELECT * FROM houses WHERE company_id = ?`).all(user.company_id) as any[]
  ).filter((row) => scoped(user, row) && inMonth(row.created_at));
  const customers = (
    db.prepare(`SELECT * FROM customers WHERE company_id = ?`).all(user.company_id) as any[]
  ).filter(
    (row) =>
      scoped(user, row) &&
      !row.merged_into_id &&
      inMonth(row.created_at) &&
      (user.role !== "agent" || row.agent_id === user.id)
  );
  const follows = (
    db
      .prepare(`SELECT * FROM follows WHERE company_id = ? AND voided = 0`)
      .all(user.company_id) as any[]
  ).filter(
    (row) =>
      scoped(user, row) &&
      inMonth(row.created_at) &&
      (user.role !== "agent" || row.created_by === user.id)
  );
  const views = (
    db.prepare(`SELECT * FROM views WHERE company_id = ?`).all(user.company_id) as any[]
  ).filter(
    (row) =>
      scoped(user, row) &&
      inMonth(row.view_at) &&
      (user.role !== "agent" || row.agent_id === user.id)
  );
  const deals = (
    db
      .prepare(`SELECT * FROM deals WHERE company_id = ? AND status = 'approved'`)
      .all(user.company_id) as any[]
  ).filter((row) => {
    if (!scoped(user, row) || !inMonth(row.approved_at)) return false;
    if (user.role !== "agent") return true;
    const agents = JSON.parse(row.agent_ids || "[]") as string[];
    return agents.includes(user.id);
  });
  const dealIds = new Set(deals.map((row) => row.id));
  const payments = (
    db
      .prepare(
        `SELECT * FROM payments WHERE company_id = ? AND status = 'confirmed'`
      )
      .all(user.company_id) as any[]
  ).filter((row) => dealIds.has(row.deal_id) && inMonth(row.paid_at));
  const commissionTotal = deals.reduce(
    (sum, row) => sum + Number(row.commission_total),
    0
  );
  const paidTotal = payments.reduce(
    (sum, row) => sum + Number(row.amount) * (row.direction === "out" ? -1 : 1),
    0
  );

  const rankings = new Map<
    string,
    { user_id: string; display_name: string; deal_count: number; performance: number }
  >();
  for (const deal of deals) {
    const ratios = JSON.parse(deal.split_ratios || "{}") as Record<string, number>;
    for (const [userId, ratio] of Object.entries(ratios)) {
      if (user.role === "agent" && userId !== user.id) continue;
      const employee = db
        .prepare(`SELECT display_name FROM users WHERE id = ?`)
        .get(userId) as any;
      const current = rankings.get(userId) || {
        user_id: userId,
        display_name: employee?.display_name || userId,
        deal_count: 0,
        performance: 0,
      };
      current.deal_count += 1;
      current.performance += Number(deal.commission_total) * (Number(ratio) / 100);
      rankings.set(userId, current);
    }
  }

  return {
    ok: true,
    data: {
      month: range.month,
      houses_added: houses.length,
      customers_added: customers.length,
      follows_created: follows.length,
      views_created: views.length,
      deals_approved: deals.length,
      commission_total: commissionTotal,
      paid_total: paidTotal,
      unpaid_total: commissionTotal - paidTotal,
      rankings: [...rankings.values()].sort((a, b) => b.performance - a.performance),
    },
  };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvFile(filename: string, header: string[], rows: unknown[][]): ApiResult {
  return {
    ok: true,
    data: {
      filename,
      mime: "text/csv;charset=utf-8",
      content: `\uFEFF${[
        header.map(csvCell).join(","),
        ...rows.map((row) => row.map(csvCell).join(",")),
      ].join("\r\n")}`,
      rows: rows.length,
    },
  };
}

function dataRows(result: ApiResult): any[] | null {
  return result.ok ? (result.data as any[]) : null;
}

export function exportHousesCsv(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  const rows = dataRows(listHouses(db, user, payload));
  if (!rows) return { ok: false, message: "无房源导出权限", code: 403 };
  writeAudit(db, user, "house.export", "house", undefined, { rows: rows.length });
  return csvFile(
    `房源列表-${todayDate()}.csv`,
    ["房源编号", "门店", "租售", "物业", "状态", "小区", "标题", "价格", "面积", "接盘人", "业主", "业主电话"],
    rows.map((row) => [
      row.id,
      row.store_id,
      row.deal_type,
      row.property_type,
      row.status,
      row.community,
      row.title,
      row.price,
      row.area_size,
      row.agent_id,
      row.owner_name,
      row.owner_phone,
    ])
  );
}

export function exportCustomersCsv(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  const rows = dataRows(listCustomers(db, user, payload));
  if (!rows) return { ok: false, message: "无客源导出权限", code: 403 };
  writeAudit(db, user, "customer.export", "customer", undefined, { rows: rows.length });
  return csvFile(
    `客源列表-${todayDate()}.csv`,
    ["客源编号", "门店", "姓名", "电话", "意图", "预算下限", "预算上限", "等级", "公私", "状态", "维护人", "来源"],
    rows.map((row) => [
      row.id,
      row.store_id,
      row.name,
      row.phone,
      row.intent,
      row.budget_min,
      row.budget_max,
      row.level,
      row.visibility,
      row.status,
      row.agent_id,
      row.source,
    ])
  );
}

export function exportFollowsCsv(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  const rows = dataRows(listFollows(db, user, payload));
  if (!rows) return { ok: false, message: "无跟进导出权限", code: 403 };
  writeAudit(db, user, "follow.export", "follow", undefined, { rows: rows.length });
  return csvFile(
    `跟进明细-${todayDate()}.csv`,
    ["跟进编号", "门店", "对象类型", "对象编号", "方式", "类型", "内容", "下次跟进", "跟进人", "创建时间"],
    rows.map((row) => [
      row.id,
      row.store_id,
      row.target_type,
      row.target_id,
      row.method,
      row.follow_kind,
      row.content,
      row.next_follow_at,
      row.created_by,
      row.created_at,
    ])
  );
}

export function exportViewsCsv(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  const rows = dataRows(listViews(db, user, payload));
  if (!rows) return { ok: false, message: "无带看导出权限", code: 403 };
  writeAudit(db, user, "view.export", "view", undefined, { rows: rows.length });
  return csvFile(
    `带看明细-${todayDate()}.csv`,
    ["带看编号", "门店", "客户", "房源", "主看人", "陪看人", "时间", "状态", "反馈", "内容"],
    rows.map((row) => [
      row.id,
      row.store_id,
      row.customer_id,
      row.house_id,
      row.agent_id,
      (row.accompany_ids || []).join("|"),
      row.view_at,
      row.status,
      row.feedback,
      row.content,
    ])
  );
}

export function activityStats(
  db: Db,
  user: SessionUser,
  payload: { month?: string } = {}
): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const range = monthRange(payload.month);
  const follows = dataRows(listFollows(db, user)) || [];
  const views = dataRows(listViews(db, user)) || [];
  const inRange = (value: string) => value >= range.start && value < range.end;
  const followRows = follows.filter((row) => inRange(row.created_at));
  const viewRows = views.filter((row) => inRange(row.view_at));
  const users = new Map<string, any>();
  const ensure = (id: string) => {
    if (!users.has(id)) {
      const employee = db.prepare(`SELECT display_name FROM users WHERE id=?`).get(id) as any;
      users.set(id, {
        user_id: id,
        display_name: employee?.display_name || id,
        follow_count: 0,
        price_change_count: 0,
        view_count: 0,
        effective_view_count: 0,
      });
    }
    return users.get(id);
  };
  for (const row of followRows) {
    const item = ensure(row.created_by);
    item.follow_count++;
    if (row.follow_kind === "price_change") item.price_change_count++;
  }
  for (const row of viewRows) {
    const item = ensure(row.agent_id);
    item.view_count++;
    if (["interested", "considering", "deal"].includes(row.feedback)) item.effective_view_count++;
  }
  return {
    ok: true,
    data: {
      month: range.month,
      follow_count: followRows.length,
      view_count: viewRows.length,
      effective_view_count: viewRows.filter((row) =>
        ["interested", "considering", "deal"].includes(row.feedback)
      ).length,
      rankings: [...users.values()].sort(
        (a, b) => b.follow_count + b.view_count - a.follow_count - a.view_count
      ),
    },
  };
}

export function exportDealsCsv(
  db: Db,
  user: SessionUser,
  payload: { month?: string } = {}
): ApiResult {
  const range = monthRange(payload.month);
  let rows = db
    .prepare(
      `SELECT d.*, h.title AS house_title, c.name AS customer_name,
       COALESCE((
         SELECT SUM(CASE WHEN p.direction='out' THEN -p.amount ELSE p.amount END) FROM payments p
         WHERE p.deal_id = d.id AND p.status = 'confirmed'
       ), 0) AS paid_amount
       FROM deals d
       JOIN houses h ON h.id = d.house_id
       JOIN customers c ON c.id = d.customer_id
       WHERE d.company_id = ? AND d.status = 'approved'
       AND d.approved_at >= ? AND d.approved_at < ?
       ORDER BY d.approved_at`
    )
    .all(user.company_id, range.start, range.end) as any[];
  rows = rows.filter((row) => {
    if (!scoped(user, row)) return false;
    if (user.role !== "agent") return true;
    return (JSON.parse(row.agent_ids || "[]") as string[]).includes(user.id);
  });
  const header = [
    "成交单号",
    "门店",
    "房源",
    "客户",
    "成交日期",
    "成交价",
    "应收佣金",
    "已收佣金",
    "未收佣金",
  ];
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.id,
        row.store_id,
        row.house_title,
        row.customer_name,
        row.deal_date,
        row.contract_price,
        row.commission_total,
        row.paid_amount,
        Number(row.commission_total) - Number(row.paid_amount),
      ]
        .map(csvCell)
        .join(",")
    ),
  ];
  return {
    ok: true,
    data: {
      filename: `成交报表-${range.month}.csv`,
      mime: "text/csv;charset=utf-8",
      content: `\uFEFF${lines.join("\r\n")}`,
      rows: rows.length,
    },
  };
}
