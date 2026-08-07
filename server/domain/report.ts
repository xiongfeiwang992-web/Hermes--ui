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
