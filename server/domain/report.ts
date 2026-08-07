import type { Db } from "../db/database";
import { listFollows } from "./activity";
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
        `SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE deal_id = ? AND status = 'confirmed'`
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
  const paidTotal = payments.reduce((sum, row) => sum + Number(row.amount), 0);

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
         SELECT SUM(p.amount) FROM payments p
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
