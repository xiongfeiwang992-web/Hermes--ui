import type { Db } from "../db/database";
import { listFollows, listViews } from "./activity";
import { listHouses } from "./house";
import { listCustomers } from "./customer";
import { listPayments } from "./deal";
import { labelCustomerSource, normalizeCustomerSource } from "./config";
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

  const company = db
    .prepare(`SELECT name FROM companies WHERE id = ?`)
    .get(user.company_id) as { name?: string } | undefined;
  const storeCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM stores WHERE company_id = ? AND status = 'active'`
      )
      .get(user.company_id) as { c: number }
  ).c;
  const employeeCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM users WHERE company_id = ? AND status = 'active'`
      )
      .get(user.company_id) as { c: number }
  ).c;

  return {
    ok: true,
    data: {
      company_name: company?.name || "",
      store_count: storeCount,
      employee_count: employeeCount,
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

export function exportPaymentsCsv(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  const rows = dataRows(listPayments(db, user, payload));
  if (!rows) return { ok: false, message: "无收款导出权限", code: 403 };
  let confirmedIn = 0;
  let confirmedOut = 0;
  let pendingIn = 0;
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    const direction = row.direction || "in";
    if (row.status === "confirmed") {
      if (direction === "out") confirmedOut += amount;
      else confirmedIn += amount;
    } else if (row.status === "pending" && direction !== "out") {
      pendingIn += amount;
    }
  }
  writeAudit(db, user, "payment.export", "payment", undefined, {
    rows: rows.length,
    confirmed_in: confirmedIn,
    confirmed_out: confirmedOut,
    pending_in: pendingIn,
    net_confirmed: confirmedIn - confirmedOut,
  });
  return csvFile(
    `收款列表-${todayDate()}.csv`,
    [
      "收款编号",
      "门店",
      "成交单号",
      "方向",
      "状态",
      "金额",
      "方式",
      "付款方",
      "收款时间",
      "备注",
    ],
    rows.map((row) => [
      row.id,
      row.store_id,
      row.deal_id,
      (row.direction || "in") === "out" ? "退款" : "收款",
      row.status,
      row.amount,
      row.method_label || row.method,
      row.payer_side,
      row.paid_at,
      row.remark || row.reject_reason || "",
    ])
  );
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
  const kindLabel = (kind: string) =>
    kind === "price_change" ? "改价跟进" : kind === "modification" ? "资料修改" : "普通跟进";
  return csvFile(
    `跟进明细-${todayDate()}.csv`,
    ["跟进编号", "门店", "对象类型", "对象编号", "方式", "类型", "内容", "下次跟进", "跟进人", "创建时间"],
    rows.map((row) => [
      row.id,
      row.store_id,
      row.target_type === "house" ? "房源" : row.target_type === "customer" ? "客源" : row.target_type,
      row.target_id,
      row.method_label || row.method,
      kindLabel(row.follow_kind || "normal"),
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

function priceBand(dealType: string, price: number): string {
  if (dealType === "rent") {
    if (price < 2000) return "<2000";
    if (price < 4000) return "2000-3999";
    if (price < 6000) return "4000-5999";
    if (price < 10000) return "6000-9999";
    return "10000+";
  }
  if (price < 100) return "<100万";
  if (price < 200) return "100-199万";
  if (price < 300) return "200-299万";
  if (price < 500) return "300-499万";
  return "500万+";
}

function areaBand(area: number | null | undefined): string {
  const value = Number(area || 0);
  if (!(value > 0)) return "未填";
  if (value < 60) return "<60㎡";
  if (value < 90) return "60-89㎡";
  if (value < 120) return "90-119㎡";
  if (value < 150) return "120-149㎡";
  return "150㎡+";
}

function bump(
  map: Map<string, any>,
  key: string,
  base: Record<string, unknown>,
  amountField?: { field: string; amount: number }
) {
  const current = map.get(key) || { ...base, count: 0, commission_total: 0, contract_price_total: 0 };
  current.count += 1;
  if (amountField) {
    current[amountField.field] =
      Number(current[amountField.field] || 0) + Number(amountField.amount || 0);
  }
  map.set(key, current);
}

function approvedDealsInMonth(db: Db, user: SessionUser, month?: string) {
  const range = monthRange(month);
  const rows = db
    .prepare(
      `SELECT d.*, h.community, h.deal_type, h.property_type, h.price AS house_price,
              h.area_size, h.title AS house_title
       FROM deals d
       JOIN houses h ON h.id = d.house_id
       WHERE d.company_id = ? AND d.status = 'approved'
         AND d.approved_at >= ? AND d.approved_at < ?`
    )
    .all(user.company_id, range.start, range.end) as any[];
  return {
    range,
    rows: rows.filter((row) => {
      if (!scoped(user, row)) return false;
      if (user.role !== "agent") return true;
      return (JSON.parse(row.agent_ids || "[]") as string[]).includes(user.id);
    }),
  };
}

export function dealHotspots(
  db: Db,
  user: SessionUser,
  payload: { month?: string } = {}
): ApiResult {
  const { range, rows } = approvedDealsInMonth(db, user, payload.month);
  const byCommunity = new Map<string, any>();
  const byPrice = new Map<string, any>();
  const byArea = new Map<string, any>();
  for (const row of rows) {
    const community = row.community || "未填小区";
    bump(byCommunity, community, { community }, { field: "commission_total", amount: row.commission_total });
    byCommunity.get(community).contract_price_total += Number(row.contract_price || 0);
    const priceKey = priceBand(row.deal_type || "sale", Number(row.contract_price || row.house_price || 0));
    bump(byPrice, `${row.deal_type || "sale"}:${priceKey}`, {
      deal_type: row.deal_type || "sale",
      price_band: priceKey,
    });
    const areaKey = areaBand(row.area_size);
    bump(byArea, areaKey, { area_band: areaKey });
  }
  return {
    ok: true,
    data: {
      month: range.month,
      deal_count: rows.length,
      by_community: [...byCommunity.values()].sort((a, b) => b.count - a.count),
      by_price_band: [...byPrice.values()].sort((a, b) => b.count - a.count),
      by_area_band: [...byArea.values()].sort((a, b) => b.count - a.count),
    },
  };
}

export function houseAttributes(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const houses = (
    db.prepare(`SELECT * FROM houses WHERE company_id = ?`).all(user.company_id) as any[]
  ).filter((row) => scoped(user, row));
  const byDealType = new Map<string, any>();
  const byProperty = new Map<string, any>();
  const byPrice = new Map<string, any>();
  for (const row of houses) {
    bump(byDealType, row.deal_type || "sale", { deal_type: row.deal_type || "sale" });
    const propertyType = row.property_type || "residential";
    bump(byProperty, `${row.deal_type || "sale"}:${propertyType}`, {
      deal_type: row.deal_type || "sale",
      property_type: propertyType,
    });
    const band = priceBand(row.deal_type || "sale", Number(row.price || 0));
    bump(byPrice, `${row.deal_type || "sale"}:${band}`, {
      deal_type: row.deal_type || "sale",
      price_band: band,
    });
  }
  return {
    ok: true,
    data: {
      house_count: houses.length,
      by_deal_type: [...byDealType.values()].sort((a, b) => b.count - a.count),
      by_property_type: [...byProperty.values()].sort((a, b) => b.count - a.count),
      by_price_band: [...byPrice.values()].sort((a, b) => b.count - a.count),
    },
  };
}

export function customerSources(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const customers = (
    db.prepare(`SELECT * FROM customers WHERE company_id = ?`).all(user.company_id) as any[]
  ).filter(
    (row) =>
      scoped(user, row) &&
      !row.merged_into_id &&
      (user.role !== "agent" || row.agent_id === user.id)
  );
  const bySource = new Map<string, any>();
  for (const row of customers) {
    const source = normalizeCustomerSource(row.source) || "未填写";
    const source_label =
      source === "未填写" ? "未填写" : labelCustomerSource(db, user.company_id, source) || source;
    bump(bySource, source, { source, source_label });
  }
  return {
    ok: true,
    data: {
      customer_count: customers.length,
      by_source: [...bySource.values()].sort((a, b) => b.count - a.count),
    },
  };
}

export function exportDealHotspotsCsv(
  db: Db,
  user: SessionUser,
  payload: { month?: string } = {}
): ApiResult {
  const result = dealHotspots(db, user, payload);
  if (!result.ok) return result;
  const data = result.data as any;
  writeAudit(db, user, "report.dealHotspots.export", "report", undefined, {
    month: data.month,
  });
  return csvFile(
    `成交热点-${data.month}.csv`,
    ["维度", "分组", "成交单数", "成交价合计", "佣金合计"],
    [
      ...data.by_community.map((row: any) => [
        "小区",
        row.community,
        row.count,
        row.contract_price_total,
        row.commission_total,
      ]),
      ...data.by_price_band.map((row: any) => [
        "总价段",
        `${row.deal_type}/${row.price_band}`,
        row.count,
        "",
        "",
      ]),
      ...data.by_area_band.map((row: any) => ["面积段", row.area_band, row.count, "", ""]),
    ]
  );
}

export function exportHouseAttributesCsv(db: Db, user: SessionUser): ApiResult {
  const result = houseAttributes(db, user);
  if (!result.ok) return result;
  const data = result.data as any;
  writeAudit(db, user, "report.houseAttributes.export", "report", undefined, {
    rows: data.house_count,
  });
  return csvFile(
    `盘源属性分析-${todayDate()}.csv`,
    ["维度", "分组", "房源数"],
    [
      ...data.by_deal_type.map((row: any) => ["租售", row.deal_type, row.count]),
      ...data.by_property_type.map((row: any) => [
        "物业类型",
        `${row.deal_type}/${row.property_type}`,
        row.count,
      ]),
      ...data.by_price_band.map((row: any) => [
        "价格段",
        `${row.deal_type}/${row.price_band}`,
        row.count,
      ]),
    ]
  );
}

export function exportCustomerSourcesCsv(db: Db, user: SessionUser): ApiResult {
  const result = customerSources(db, user);
  if (!result.ok) return result;
  const data = result.data as any;
  writeAudit(db, user, "report.customerSources.export", "report", undefined, {
    rows: data.customer_count,
  });
  return csvFile(
    `客户来源分析-${todayDate()}.csv`,
    ["来源", "客户数"],
    data.by_source.map((row: any) => [row.source_label || row.source, row.count])
  );
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
