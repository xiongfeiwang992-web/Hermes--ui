import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const MANAGEMENT_TYPES = new Set(["rent_out", "centralized", "self_owned"]);
const WORK_TYPES = new Set(["maintenance", "cleaning"]);
const PAYMENT_CYCLES = new Set([1, 2, 3, 6, 12]);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addMonths(value: string, months: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function previousDay(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function canManageStore(user: SessionUser, storeId: string): boolean {
  return user.role === "admin" || (user.role === "store_manager" && user.store_id === storeId);
}

function propertyVisible(user: SessionUser, row: any): boolean {
  return (
    user.role === "admin" ||
    user.role === "finance" ||
    (user.role === "store_manager" && row.store_id === user.store_id) ||
    row.manager_user_id === user.id
  );
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
    `INSERT INTO rental_events(
      id, company_id, entity_type, entity_id, event_type, details, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("RTE"),
    user.company_id,
    entityType,
    entityId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function refreshStatuses(db: Db, companyId: string) {
  const date = today();
  db.prepare(
    `UPDATE rental_bills SET status='overdue', updated_at=?
     WHERE company_id=? AND status='pending' AND due_date<?`
  ).run(nowIso(), companyId, date);
  db.prepare(
    `UPDATE rental_leases SET status='expired', updated_at=?
     WHERE company_id=? AND status='active' AND end_date<?`
  ).run(nowIso(), companyId, date);
  db.prepare(
    `UPDATE rental_properties SET status='expired', updated_at=?
     WHERE company_id=? AND status='active' AND end_date<?
       AND NOT EXISTS(
         SELECT 1 FROM rental_leases l
         WHERE l.property_id=rental_properties.id AND l.status='active'
       )`
  ).run(nowIso(), companyId, date);
}

export function rentalOptions(db: Db, user: SessionUser): ApiResult {
  let stores = db
    .prepare(`SELECT id, name FROM stores WHERE company_id=? AND status='active' ORDER BY name`)
    .all(user.company_id) as any[];
  let houses = db
    .prepare(
      `SELECT id, store_id, title, community, address FROM houses
       WHERE company_id=? AND deal_type='rent' AND status IN ('available', 'closed')
       ORDER BY updated_at DESC`
    )
    .all(user.company_id) as any[];
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  if (user.role === "store_manager" || user.role === "agent") {
    stores = stores.filter((row) => row.id === user.store_id);
    houses = houses.filter((row) => row.store_id === user.store_id);
    users = users.filter((row) => row.store_id === user.store_id);
  }
  if (user.role === "finance") {
    houses = [];
    users = [];
  }
  return { ok: true, data: { stores, houses, users } };
}

export function listProperties(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  refreshStatuses(db, user.company_id);
  let rows = db
    .prepare(
      `SELECT p.*, h.title AS house_title, h.community, h.address,
       h.owner_name, h.owner_phone, s.name AS store_name,
       u.display_name AS manager_name,
       (SELECT COUNT(*) FROM rental_leases l
        WHERE l.property_id=p.id AND l.status='active') AS active_lease_count,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='rental_property' AND a.parent_id=p.id
          AND a.category='management_contract') AS contract_attachment_count
       FROM rental_properties p
       JOIN houses h ON h.id=p.house_id
       JOIN stores s ON s.id=p.store_id
       JOIN users u ON u.id=p.manager_user_id
       WHERE p.company_id=? ORDER BY p.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => propertyVisible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.store_id && user.role === "admin")
    rows = rows.filter((row) => row.store_id === payload.store_id);
  return { ok: true, data: rows };
}

export function createProperty(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无托管物业登记权限", code: 403 };
  if (!MANAGEMENT_TYPES.has(payload.management_type))
    return { ok: false, message: "托管类型无效" };
  if (!validDate(payload.start_date) || !validDate(payload.end_date))
    return { ok: false, message: "托管日期无效" };
  if (payload.end_date < payload.start_date)
    return { ok: false, message: "托管结束日期不得早于开始日期" };
  const ownerPayment = Number(payload.owner_payment || 0);
  if (!Number.isFinite(ownerPayment) || ownerPayment < 0)
    return { ok: false, message: "业主月付款金额无效" };
  const house = db
    .prepare(`SELECT * FROM houses WHERE id=? AND company_id=? AND deal_type='rent'`)
    .get(payload.house_id, user.company_id) as any;
  if (!house || (user.role === "store_manager" && house.store_id !== user.store_id))
    return { ok: false, message: "租赁房源不存在或无权限", code: 403 };
  const manager = db
    .prepare(
      `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=? AND status='active'`
    )
    .get(payload.manager_user_id, user.company_id, house.store_id);
  if (!manager) return { ok: false, message: "托管负责人必须为同店在职员工" };
  if (
    db
      .prepare(`SELECT id FROM rental_properties WHERE company_id=? AND house_id=?`)
      .get(user.company_id, house.id)
  )
    return { ok: false, message: "该房源已登记托管" };
  const id = nextId("RTP");
  const now = nowIso();
  db.prepare(
    `INSERT INTO rental_properties(
      id, company_id, store_id, house_id, management_type, manager_user_id,
      start_date, end_date, owner_payment, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    house.store_id,
    house.id,
    payload.management_type,
    payload.manager_user_id,
    payload.start_date,
    payload.end_date,
    ownerPayment,
    user.id,
    now,
    now
  );
  addEvent(db, user, "property", id, "created", {
    house_id: house.id,
    management_type: payload.management_type,
  });
  writeAudit(db, user, "rental.property.create", "rental_property", id);
  return { ok: true, data: { id, status: "draft" } };
}

export function activateProperty(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM rental_properties WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManageStore(user, row.store_id))
    return { ok: false, message: "托管物业不存在或无权限", code: 403 };
  if (row.status !== "draft") return { ok: false, message: "仅草稿托管可启用" };
  const attachment = db
    .prepare(
      `SELECT id FROM file_attachments WHERE parent_type='rental_property'
       AND parent_id=? AND category='management_contract' LIMIT 1`
    )
    .get(row.id);
  if (!attachment) return { ok: false, message: "请先上传托管合同" };
  db.prepare(`UPDATE rental_properties SET status='active', updated_at=? WHERE id=?`).run(
    nowIso(),
    row.id
  );
  addEvent(db, user, "property", row.id, "activated");
  writeAudit(db, user, "rental.property.activate", "rental_property", row.id);
  return { ok: true, data: { id: row.id, status: "active" } };
}

export function terminateProperty(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM rental_properties WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManageStore(user, row.store_id))
    return { ok: false, message: "托管物业不存在或无权限", code: 403 };
  if (!["active", "expired"].includes(row.status))
    return { ok: false, message: "当前托管状态不可终止" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "终止原因必填" };
  const activeLease = db
    .prepare(`SELECT id FROM rental_leases WHERE property_id=? AND status='active'`)
    .get(row.id);
  if (activeLease) return { ok: false, message: "请先终止生效中的租约" };
  db.prepare(
    `UPDATE rental_properties SET status='terminated', termination_reason=?,
     updated_at=? WHERE id=?`
  ).run(reason, nowIso(), row.id);
  addEvent(db, user, "property", row.id, "terminated", { reason });
  writeAudit(db, user, "rental.property.terminate", "rental_property", row.id, { reason });
  return { ok: true, data: { id: row.id, status: "terminated" } };
}

export function listLeases(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  refreshStatuses(db, user.company_id);
  let rows = db
    .prepare(
      `SELECT l.*, p.house_id, p.manager_user_id, h.title AS house_title,
       s.name AS store_name,
       (SELECT COUNT(*) FROM rental_bills b WHERE b.lease_id=l.id) AS bill_count,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='rental_lease' AND a.parent_id=l.id
          AND a.category='signed_lease') AS lease_attachment_count
       FROM rental_leases l
       JOIN rental_properties p ON p.id=l.property_id
       JOIN houses h ON h.id=p.house_id
       JOIN stores s ON s.id=l.store_id
       WHERE l.company_id=? ORDER BY l.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => propertyVisible(user, row));
  if (payload.property_id)
    rows = rows.filter((row) => row.property_id === payload.property_id);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function createLease(db: Db, user: SessionUser, payload: any): ApiResult {
  const property = db
    .prepare(`SELECT * FROM rental_properties WHERE id=? AND company_id=?`)
    .get(payload.property_id, user.company_id) as any;
  if (!property || !canManageStore(user, property.store_id))
    return { ok: false, message: "托管物业不存在或无权限", code: 403 };
  if (property.status !== "active") return { ok: false, message: "托管物业未生效" };
  const tenantName = String(payload.tenant_name || "").trim();
  const tenantPhone = String(payload.tenant_phone || "").replace(/\s/g, "");
  if (!tenantName || !/^1\d{10}$/.test(tenantPhone))
    return { ok: false, message: "租客姓名或手机号无效" };
  if (!validDate(payload.start_date) || !validDate(payload.end_date))
    return { ok: false, message: "租约日期无效" };
  if (
    payload.end_date < payload.start_date ||
    payload.start_date < property.start_date ||
    payload.end_date > property.end_date
  )
    return { ok: false, message: "租约期限必须位于托管期限内" };
  const monthlyRent = Number(payload.monthly_rent);
  const deposit = Number(payload.deposit_amount || 0);
  const cycle = Number(payload.payment_cycle_months);
  if (!Number.isFinite(monthlyRent) || monthlyRent <= 0)
    return { ok: false, message: "月租金额无效" };
  if (!Number.isFinite(deposit) || deposit < 0)
    return { ok: false, message: "押金金额无效" };
  if (!PAYMENT_CYCLES.has(cycle)) return { ok: false, message: "付款周期无效" };
  if (
    !validDate(payload.first_due_date) ||
    payload.first_due_date < payload.start_date ||
    payload.first_due_date > previousDay(addMonths(payload.start_date, cycle))
  )
    return { ok: false, message: "首期应收日期必须位于首个付款周期内" };
  const overlap = db
    .prepare(
      `SELECT id FROM rental_leases WHERE property_id=?
       AND status IN ('draft', 'active')
       AND NOT(end_date<? OR start_date>?)`
    )
    .get(property.id, payload.start_date, payload.end_date);
  if (overlap) return { ok: false, message: "该托管物业存在重叠租约" };
  const id = nextId("RTL");
  const now = nowIso();
  db.prepare(
    `INSERT INTO rental_leases(
      id, company_id, store_id, property_id, tenant_name, tenant_phone,
      start_date, end_date, monthly_rent, deposit_amount,
      payment_cycle_months, first_due_date, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    property.store_id,
    property.id,
    tenantName,
    tenantPhone,
    payload.start_date,
    payload.end_date,
    monthlyRent,
    deposit,
    cycle,
    payload.first_due_date,
    user.id,
    now,
    now
  );
  addEvent(db, user, "lease", id, "created");
  writeAudit(db, user, "rental.lease.create", "rental_lease", id);
  return { ok: true, data: { id, status: "draft" } };
}

export function activateLease(db: Db, user: SessionUser, payload: any): ApiResult {
  const lease = db
    .prepare(
      `SELECT l.*, p.manager_user_id, p.status AS property_status
       FROM rental_leases l JOIN rental_properties p ON p.id=l.property_id
       WHERE l.id=? AND l.company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (!lease || !canManageStore(user, lease.store_id))
    return { ok: false, message: "租约不存在或无权限", code: 403 };
  if (lease.status !== "draft" || lease.property_status !== "active")
    return { ok: false, message: "当前租约或托管状态不可启用" };
  const attachment = db
    .prepare(
      `SELECT id FROM file_attachments WHERE parent_type='rental_lease'
       AND parent_id=? AND category='signed_lease' LIMIT 1`
    )
    .get(lease.id);
  if (!attachment) return { ok: false, message: "请先上传已签租约" };
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE rental_leases SET status='active', activated_by=?,
       activated_at=?, updated_at=? WHERE id=?`
    ).run(user.id, now, now, lease.id);
    let periodStart = lease.start_date;
    let dueDate = lease.first_due_date;
    while (periodStart <= lease.end_date) {
      const nextPeriod = addMonths(periodStart, lease.payment_cycle_months);
      const periodEnd =
        previousDay(nextPeriod) < lease.end_date ? previousDay(nextPeriod) : lease.end_date;
      let months = 0;
      let cursor = periodStart;
      while (cursor <= periodEnd && months < lease.payment_cycle_months) {
        months++;
        cursor = addMonths(cursor, 1);
      }
      db.prepare(
        `INSERT INTO rental_bills(
          id, company_id, store_id, lease_id, period_start, period_end,
          due_date, amount, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(
        nextId("RTB"),
        user.company_id,
        lease.store_id,
        lease.id,
        periodStart,
        periodEnd,
        dueDate,
        Number(lease.monthly_rent) * months,
        now,
        now
      );
      periodStart = nextPeriod;
      dueDate = addMonths(dueDate, lease.payment_cycle_months);
    }
    addEvent(db, user, "lease", lease.id, "activated");
  });
  tx();
  createMessage(db, {
    company_id: user.company_id,
    store_id: lease.store_id,
    user_id: lease.manager_user_id,
    title: "租约已生效",
    body: `${lease.tenant_name}的租约已启用并生成周期账单`,
    kind: "rental",
    ref_type: "rental_lease",
    ref_id: lease.id,
  });
  writeAudit(db, user, "rental.lease.activate", "rental_lease", lease.id);
  return { ok: true, data: { id: lease.id, status: "active" } };
}

export function terminateLease(db: Db, user: SessionUser, payload: any): ApiResult {
  const lease = db
    .prepare(`SELECT * FROM rental_leases WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!lease || !canManageStore(user, lease.store_id))
    return { ok: false, message: "租约不存在或无权限", code: 403 };
  if (!["active", "expired"].includes(lease.status))
    return { ok: false, message: "当前租约不可终止" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "租约终止原因必填" };
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE rental_leases SET status='terminated', terminated_by=?,
       terminated_at=?, termination_reason=?, updated_at=? WHERE id=?`
    ).run(user.id, now, reason, now, lease.id);
    db.prepare(
      `UPDATE rental_bills SET status='voided', void_reason=?,
       updated_at=? WHERE lease_id=? AND status IN ('pending', 'overdue')`
    ).run(`租约终止：${reason}`, now, lease.id);
    addEvent(db, user, "lease", lease.id, "terminated", { reason });
  });
  tx();
  writeAudit(db, user, "rental.lease.terminate", "rental_lease", lease.id, { reason });
  return { ok: true, data: { id: lease.id, status: "terminated" } };
}

export function listBills(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  refreshStatuses(db, user.company_id);
  let rows = db
    .prepare(
      `SELECT b.*, l.tenant_name, l.tenant_phone, l.property_id,
       p.manager_user_id, h.title AS house_title, s.name AS store_name
       FROM rental_bills b
       JOIN rental_leases l ON l.id=b.lease_id
       JOIN rental_properties p ON p.id=l.property_id
       JOIN houses h ON h.id=p.house_id
       JOIN stores s ON s.id=b.store_id
       WHERE b.company_id=? ORDER BY b.due_date, b.created_at`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => propertyVisible(user, row));
  if (payload.lease_id) rows = rows.filter((row) => row.lease_id === payload.lease_id);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function payBill(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "finance"))
    return { ok: false, message: "仅管理员或财务可确认收租", code: 403 };
  const bill = db
    .prepare(
      `SELECT b.*, l.tenant_name, p.manager_user_id FROM rental_bills b
       JOIN rental_leases l ON l.id=b.lease_id
       JOIN rental_properties p ON p.id=l.property_id
       WHERE b.id=? AND b.company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (!bill || !["pending", "overdue"].includes(bill.status))
    return { ok: false, message: "账单不存在或当前不可收款" };
  if (!["cash", "bank", "other"].includes(payload.payment_method))
    return { ok: false, message: "收款方式无效" };
  const paidAmount = Number(payload.paid_amount);
  if (!Number.isFinite(paidAmount) || paidAmount !== Number(bill.amount))
    return { ok: false, message: "本期仅支持足额收款" };
  const reference = String(payload.payment_reference || "").trim();
  if (payload.payment_method === "bank" && !reference)
    return { ok: false, message: "银行收款必须填写流水号" };
  const now = nowIso();
  db.prepare(
    `UPDATE rental_bills SET status='paid', paid_amount=?, payment_method=?,
     payment_reference=?, paid_by=?, paid_at=?, updated_at=? WHERE id=?`
  ).run(paidAmount, payload.payment_method, reference || null, user.id, now, now, bill.id);
  addEvent(db, user, "bill", bill.id, "paid", {
    amount: paidAmount,
    payment_method: payload.payment_method,
  });
  if (bill.manager_user_id !== user.id)
    createMessage(db, {
      company_id: user.company_id,
      store_id: bill.store_id,
      user_id: bill.manager_user_id,
      title: "租金已收款",
      body: `${bill.tenant_name}租金 ¥${bill.amount} 已确认`,
      kind: "rental",
      ref_type: "rental_bill",
      ref_id: bill.id,
    });
  writeAudit(db, user, "rental.bill.pay", "rental_bill", bill.id, {
    amount: paidAmount,
  });
  return { ok: true, data: { id: bill.id, status: "paid" } };
}

export function voidBill(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可作废账单", code: 403 };
  const bill = db
    .prepare(`SELECT * FROM rental_bills WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!bill || !["pending", "overdue"].includes(bill.status))
    return { ok: false, message: "账单不存在或当前不可作废" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "作废原因必填" };
  db.prepare(
    `UPDATE rental_bills SET status='voided', void_reason=?, updated_at=? WHERE id=?`
  ).run(reason, nowIso(), bill.id);
  addEvent(db, user, "bill", bill.id, "voided", { reason });
  writeAudit(db, user, "rental.bill.void", "rental_bill", bill.id, { reason });
  return { ok: true, data: { id: bill.id, status: "voided" } };
}

export function listWorkOrders(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT w.*, p.manager_user_id, h.title AS house_title,
       assignee.display_name AS assignee_name, s.name AS store_name,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='rental_work_order' AND a.parent_id=w.id
          AND a.category='work_order_evidence') AS evidence_count
       FROM rental_work_orders w
       JOIN rental_properties p ON p.id=w.property_id
       JOIN houses h ON h.id=p.house_id
       JOIN users assignee ON assignee.id=w.assignee_user_id
       JOIN stores s ON s.id=w.store_id
       WHERE w.company_id=? ORDER BY w.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter(
    (row) => propertyVisible(user, row) || row.assignee_user_id === user.id
  );
  if (payload.property_id)
    rows = rows.filter((row) => row.property_id === payload.property_id);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function createWorkOrder(db: Db, user: SessionUser, payload: any): ApiResult {
  const property = db
    .prepare(`SELECT * FROM rental_properties WHERE id=? AND company_id=?`)
    .get(payload.property_id, user.company_id) as any;
  if (!property || !propertyVisible(user, property) || property.status !== "active")
    return { ok: false, message: "托管物业不存在、未生效或无权限", code: 403 };
  const isManagerial = canManageStore(user, property.store_id);
  if (!isManagerial && property.manager_user_id !== user.id)
    return { ok: false, message: "无工单创建权限", code: 403 };
  if (!WORK_TYPES.has(payload.work_type)) return { ok: false, message: "工单类型无效" };
  const description = String(payload.description || "").trim();
  if (!description) return { ok: false, message: "工单描述必填" };
  const expectedCost = Number(payload.expected_cost || 0);
  if (!Number.isFinite(expectedCost) || expectedCost < 0)
    return { ok: false, message: "预计费用无效" };
  const assigneeId = isManagerial ? payload.assignee_user_id : user.id;
  const assignee = db
    .prepare(
      `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=? AND status='active'`
    )
    .get(assigneeId, user.company_id, property.store_id);
  if (!assignee) return { ok: false, message: "工单负责人必须为同店在职员工" };
  if (payload.lease_id) {
    const lease = db
      .prepare(`SELECT id FROM rental_leases WHERE id=? AND property_id=?`)
      .get(payload.lease_id, property.id);
    if (!lease) return { ok: false, message: "关联租约不属于该托管物业" };
  }
  const id = nextId("RTW");
  const now = nowIso();
  db.prepare(
    `INSERT INTO rental_work_orders(
      id, company_id, store_id, property_id, lease_id, work_type,
      description, assignee_user_id, expected_cost, status,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    property.store_id,
    property.id,
    payload.lease_id || null,
    payload.work_type,
    description,
    assigneeId,
    expectedCost,
    user.id,
    now,
    now
  );
  addEvent(db, user, "work_order", id, "created");
  if (assigneeId !== user.id)
    createMessage(db, {
      company_id: user.company_id,
      store_id: property.store_id,
      user_id: assigneeId,
      title: payload.work_type === "maintenance" ? "新维修工单" : "新保洁工单",
      body: description,
      kind: "rental",
      ref_type: "rental_work_order",
      ref_id: id,
    });
  writeAudit(db, user, "rental.work_order.create", "rental_work_order", id);
  return { ok: true, data: { id, status: "pending" } };
}

export function changeWorkOrderStatus(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  const row = db
    .prepare(`SELECT * FROM rental_work_orders WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  const canOperate =
    row &&
    (canManageStore(user, row.store_id) || row.assignee_user_id === user.id);
  if (!canOperate) return { ok: false, message: "工单不存在或无权限", code: 403 };
  if (payload.status === "in_progress") {
    if (row.status !== "pending") return { ok: false, message: "仅待处理工单可开始" };
    db.prepare(`UPDATE rental_work_orders SET status='in_progress', updated_at=? WHERE id=?`).run(
      nowIso(),
      row.id
    );
    addEvent(db, user, "work_order", row.id, "started");
  } else if (payload.status === "completed") {
    if (!["pending", "in_progress"].includes(row.status))
      return { ok: false, message: "当前工单不可完成" };
    const note = String(payload.completion_note || "").trim();
    const actualCost = Number(payload.actual_cost || 0);
    if (!note) return { ok: false, message: "完成说明必填" };
    if (!Number.isFinite(actualCost) || actualCost < 0)
      return { ok: false, message: "实际费用无效" };
    const evidence = db
      .prepare(
        `SELECT id FROM file_attachments WHERE parent_type='rental_work_order'
         AND parent_id=? AND category='work_order_evidence' LIMIT 1`
      )
      .get(row.id);
    if (!evidence) return { ok: false, message: "请先上传完工凭证" };
    const now = nowIso();
    db.prepare(
      `UPDATE rental_work_orders SET status='completed', actual_cost=?,
       completion_note=?, completed_at=?, updated_at=? WHERE id=?`
    ).run(actualCost, note, now, now, row.id);
    addEvent(db, user, "work_order", row.id, "completed", {
      actual_cost: actualCost,
    });
  } else {
    return { ok: false, message: "工单状态无效" };
  }
  writeAudit(db, user, `rental.work_order.${payload.status}`, "rental_work_order", row.id);
  const property = db
    .prepare(`SELECT manager_user_id FROM rental_properties WHERE id=? AND company_id=?`)
    .get(row.property_id, user.company_id) as { manager_user_id?: string } | undefined;
  const recipients = new Set<string>();
  if (row.created_by) recipients.add(row.created_by);
  if (property?.manager_user_id) recipients.add(property.manager_user_id);
  recipients.delete(user.id);
  const isMaintenance = row.work_type === "maintenance";
  const title =
    payload.status === "in_progress"
      ? isMaintenance
        ? "维修工单已开始"
        : "保洁工单已开始"
      : isMaintenance
        ? "维修工单已完成"
        : "保洁工单已完成";
  const body =
    payload.status === "completed"
      ? `${row.description} · ¥${Number(payload.actual_cost || 0)} · ${String(
          payload.completion_note || ""
        ).trim()}`
      : row.description;
  for (const userId of recipients) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: userId,
      title,
      body,
      kind: "rental",
      ref_type: "rental_work_order",
      ref_id: row.id,
    });
  }
  return { ok: true, data: { id: row.id, status: payload.status } };
}

export function cancelWorkOrder(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM rental_work_orders WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManageStore(user, row.store_id))
    return { ok: false, message: "工单不存在或无权限", code: 403 };
  if (!["pending", "in_progress"].includes(row.status))
    return { ok: false, message: "当前工单不可取消" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "取消原因必填" };
  db.prepare(
    `UPDATE rental_work_orders SET status='cancelled', cancel_reason=?,
     updated_at=? WHERE id=?`
  ).run(reason, nowIso(), row.id);
  addEvent(db, user, "work_order", row.id, "cancelled", { reason });
  writeAudit(db, user, "rental.work_order.cancel", "rental_work_order", row.id, { reason });
  return { ok: true, data: { id: row.id, status: "cancelled" } };
}

export function listEvents(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!["property", "lease", "bill", "work_order"].includes(payload.entity_type))
    return { ok: false, message: "履历对象类型无效" };
  let scope: any;
  if (payload.entity_type === "property") {
    scope = db
      .prepare(`SELECT * FROM rental_properties WHERE id=? AND company_id=?`)
      .get(payload.entity_id, user.company_id);
  } else if (payload.entity_type === "lease") {
    scope = db
      .prepare(
        `SELECT l.*, p.manager_user_id FROM rental_leases l
         JOIN rental_properties p ON p.id=l.property_id
         WHERE l.id=? AND l.company_id=?`
      )
      .get(payload.entity_id, user.company_id);
  } else if (payload.entity_type === "bill") {
    scope = db
      .prepare(
        `SELECT b.*, p.manager_user_id FROM rental_bills b
         JOIN rental_leases l ON l.id=b.lease_id
         JOIN rental_properties p ON p.id=l.property_id
         WHERE b.id=? AND b.company_id=?`
      )
      .get(payload.entity_id, user.company_id);
  } else {
    scope = db
      .prepare(
        `SELECT w.*, p.manager_user_id FROM rental_work_orders w
         JOIN rental_properties p ON p.id=w.property_id
         WHERE w.id=? AND w.company_id=?`
      )
      .get(payload.entity_id, user.company_id);
  }
  if (
    !scope ||
    (!propertyVisible(user, scope) &&
      !(payload.entity_type === "work_order" && scope.assignee_user_id === user.id))
  )
    return { ok: false, message: "履历对象不存在或无权限", code: 403 };
  const events = db
    .prepare(
      `SELECT e.*, u.display_name AS created_by_name FROM rental_events e
       JOIN users u ON u.id=e.created_by
       WHERE e.company_id=? AND e.entity_type=? AND e.entity_id=?
       ORDER BY e.created_at DESC`
    )
    .all(user.company_id, payload.entity_type, payload.entity_id);
  return { ok: true, data: events };
}
