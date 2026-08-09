import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const COMPLAINT_CATEGORIES = new Set([
  "commission",
  "service",
  "document",
  "payment",
  "other",
]);
const RENAME_TARGETS = new Set(["customer", "owner", "both"]);

function addEvent(
  db: Db,
  user: SessionUser,
  entityType: string,
  entityId: string,
  eventType: string,
  details: unknown = {}
) {
  db.prepare(
    `INSERT INTO deal_ext_events(
      id, company_id, entity_type, entity_id, event_type, details, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("DXE"),
    user.company_id,
    entityType,
    entityId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function parseAgentIds(raw: string): string[] {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function dealVisible(user: SessionUser, deal: any): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  if (deal.store_id !== user.store_id) return false;
  if (user.role === "store_manager") return true;
  const agents = parseAgentIds(deal.agent_ids);
  return agents.includes(user.id) || deal.created_by === user.id;
}

function canManageStore(user: SessionUser, storeId: string): boolean {
  return (
    user.role === "admin" ||
    (user.role === "store_manager" && user.store_id === storeId)
  );
}

function getVisibleDeal(db: Db, user: SessionUser, dealId: string) {
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`)
    .get(dealId, user.company_id) as any;
  if (!deal || !dealVisible(user, deal)) return null;
  return deal;
}

export function dealExtOptions(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance")
    return { ok: true, data: { deals: [], users: [] } };
  let deals = db
    .prepare(
      `SELECT d.id, d.store_id, d.status, d.deal_type, d.contract_price,
              d.agent_ids, d.created_by, h.title AS house_title, c.name AS customer_name
       FROM deals d
       JOIN houses h ON h.id=d.house_id
       JOIN customers c ON c.id=d.customer_id
       WHERE d.company_id=? AND d.status='approved'
       ORDER BY d.updated_at DESC`
    )
    .all(user.company_id) as any[];
  deals = deals.filter((deal) => dealVisible(user, deal));
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' AND role<>'finance'
       ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  if (user.role !== "admin")
    users = users.filter((row) => row.store_id === user.store_id);
  return { ok: true, data: { deals, users } };
}

export function listComplaints(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  let rows = db
    .prepare(
      `SELECT c.*, d.deal_type, d.contract_price, h.title AS house_title,
              cust.name AS customer_name, u.display_name AS created_by_name,
              a.display_name AS assignee_name,
              (SELECT COUNT(*) FROM file_attachments fa
               WHERE fa.parent_type='deal_complaint' AND fa.parent_id=c.id) AS attachment_count
       FROM deal_complaints c
       JOIN deals d ON d.id=c.deal_id
       JOIN houses h ON h.id=d.house_id
       JOIN customers cust ON cust.id=d.customer_id
       JOIN users u ON u.id=c.created_by
       LEFT JOIN users a ON a.id=c.assignee_user_id
       WHERE c.company_id=?
       ORDER BY c.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    if (user.role === "admin" || user.role === "finance") return true;
    if (row.store_id !== user.store_id) return false;
    if (user.role === "store_manager") return true;
    return (
      row.created_by === user.id ||
      row.assignee_user_id === user.id ||
      parseAgentIds(
        (
          db.prepare(`SELECT agent_ids FROM deals WHERE id=?`).get(row.deal_id) as any
        )?.agent_ids || "[]"
      ).includes(user.id)
    );
  });
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.deal_id) rows = rows.filter((row) => row.deal_id === payload.deal_id);
  return { ok: true, data: rows };
}

export function createComplaint(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const deal = getVisibleDeal(db, user, payload.deal_id);
  if (!deal) return { ok: false, message: "成交单不存在或无权限", code: 403 };
  if (deal.status !== "approved")
    return { ok: false, message: "仅已审批成交可登记投诉" };
  if (!COMPLAINT_CATEGORIES.has(payload.category))
    return { ok: false, message: "投诉分类无效" };
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  if (title.length < 2) return { ok: false, message: "投诉标题至少 2 个字" };
  if (description.length < 4) return { ok: false, message: "投诉说明至少 4 个字" };
  const openSame = db
    .prepare(
      `SELECT id FROM deal_complaints
       WHERE deal_id=? AND category=? AND status IN ('open','investigating')`
    )
    .get(deal.id, payload.category) as any;
  if (openSame)
    return { ok: false, message: "该成交已有同类未结投诉", code: 409 };
  const id = nextId("DCP");
  const now = nowIso();
  db.prepare(
    `INSERT INTO deal_complaints(
       id, company_id, store_id, deal_id, category, title, description,
       status, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    deal.store_id,
    deal.id,
    payload.category,
    title,
    description,
    user.id,
    now,
    now
  );
  addEvent(db, user, "complaint", id, "created", { category: payload.category });
  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND status='active'
       AND (role='admin' OR (role='store_manager' AND store_id=?))`
    )
    .all(user.company_id, deal.store_id) as any[];
  for (const manager of managers) {
    if (manager.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: deal.store_id,
      user_id: manager.id,
      title: "新成交投诉",
      body: title,
      kind: "deal_complaint",
      ref_type: "deal_complaint",
      ref_id: id,
    });
  }
  writeAudit(db, user, "dealExt.complaint.create", "deal_complaint", id);
  return { ok: true, data: { id, status: "open" } };
}

export function investigateComplaint(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  const row = db
    .prepare(`SELECT * FROM deal_complaints WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "投诉不存在", code: 404 };
  if (!(canManageStore(user, row.store_id) || row.assignee_user_id === user.id))
    return { ok: false, message: "无调查权限", code: 403 };
  if (!["open", "investigating"].includes(row.status))
    return { ok: false, message: "当前投诉不可进入调查" };
  let assigneeId = payload.assignee_user_id || row.assignee_user_id || user.id;
  if (canManageStore(user, row.store_id) && payload.assignee_user_id) {
    const assignee = db
      .prepare(
        `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=?
         AND status='active' AND role<>'finance'`
      )
      .get(payload.assignee_user_id, user.company_id, row.store_id);
    if (!assignee) return { ok: false, message: "处理人必须为同店在职员工" };
    assigneeId = payload.assignee_user_id;
  }
  const now = nowIso();
  db.prepare(
    `UPDATE deal_complaints
     SET status='investigating', assignee_user_id=?, updated_at=? WHERE id=?`
  ).run(assigneeId, now, row.id);
  if (assigneeId !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: assigneeId,
      title: "成交投诉待处理",
      body: row.title,
      kind: "deal_complaint",
      ref_type: "deal_complaint",
      ref_id: row.id,
    });
  }
  addEvent(db, user, "complaint", row.id, "investigating", {
    assignee_user_id: assigneeId,
  });
  writeAudit(db, user, "dealExt.complaint.investigate", "deal_complaint", row.id);
  return { ok: true, data: { id: row.id, status: "investigating" } };
}

export function resolveComplaint(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM deal_complaints WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "投诉不存在", code: 404 };
  if (!(canManageStore(user, row.store_id) || row.assignee_user_id === user.id))
    return { ok: false, message: "无结案权限", code: 403 };
  if (row.status !== "investigating")
    return { ok: false, message: "仅调查中投诉可结案" };
  const resolution = String(payload.resolution || "").trim();
  if (resolution.length < 4) return { ok: false, message: "处理结果至少 4 个字" };
  const evidence = db
    .prepare(
      `SELECT id FROM file_attachments
       WHERE parent_type='deal_complaint' AND parent_id=? AND category='complaint_evidence'`
    )
    .all(row.id) as any[];
  if (!evidence.length)
    return { ok: false, message: "结案前须上传投诉处理凭证" };
  const now = nowIso();
  db.prepare(
    `UPDATE deal_complaints
     SET status='resolved', resolution=?, resolved_at=?, updated_at=? WHERE id=?`
  ).run(resolution, now, now, row.id);
  if (row.created_by !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.created_by,
      title: "成交投诉已结案",
      body: resolution,
      kind: "deal_complaint",
      ref_type: "deal_complaint",
      ref_id: row.id,
    });
  }
  addEvent(db, user, "complaint", row.id, "resolved", { resolution });
  writeAudit(db, user, "dealExt.complaint.resolve", "deal_complaint", row.id);
  return { ok: true, data: { id: row.id, status: "resolved" } };
}

export function rejectComplaint(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManageStore(user, user.store_id) && user.role !== "admin")
    return { ok: false, message: "无驳回权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "驳回原因至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM deal_complaints WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManageStore(user, row.store_id))
    return { ok: false, message: "投诉不存在或无权限", code: 403 };
  if (!["open", "investigating"].includes(row.status))
    return { ok: false, message: "当前投诉不可驳回" };
  const now = nowIso();
  db.prepare(
    `UPDATE deal_complaints
     SET status='rejected', reject_reason=?, updated_at=? WHERE id=?`
  ).run(reason, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.created_by,
    title: "成交投诉已驳回",
    body: reason,
    kind: "deal_complaint",
    ref_type: "deal_complaint",
    ref_id: row.id,
  });
  addEvent(db, user, "complaint", row.id, "rejected", { reason });
  writeAudit(db, user, "dealExt.complaint.reject", "deal_complaint", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id, status: "rejected" } };
}

export function withdrawComplaint(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "撤回原因至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM deal_complaints WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "投诉不存在", code: 404 };
  if (row.created_by !== user.id && !canManageStore(user, row.store_id))
    return { ok: false, message: "无撤回权限", code: 403 };
  if (row.status !== "open")
    return { ok: false, message: "仅未分派调查的投诉可撤回" };
  const now = nowIso();
  db.prepare(
    `UPDATE deal_complaints
     SET status='withdrawn', reject_reason=?, updated_at=? WHERE id=?`
  ).run(reason, now, row.id);
  addEvent(db, user, "complaint", row.id, "withdrawn", { reason });
  writeAudit(db, user, "dealExt.complaint.withdraw", "deal_complaint", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id, status: "withdrawn" } };
}

export function listRenames(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  let rows = db
    .prepare(
      `SELECT r.*, d.deal_type, h.title AS house_title, c.name AS customer_name,
              u.display_name AS created_by_name,
              (SELECT COUNT(*) FROM file_attachments fa
               WHERE fa.parent_type='deal_rename' AND fa.parent_id=r.id) AS attachment_count
       FROM deal_renames r
       JOIN deals d ON d.id=r.deal_id
       JOIN houses h ON h.id=d.house_id
       JOIN customers c ON c.id=d.customer_id
       JOIN users u ON u.id=r.created_by
       WHERE r.company_id=?
       ORDER BY r.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    if (user.role === "admin") return true;
    if (user.role === "finance") return false;
    if (row.store_id !== user.store_id) return false;
    if (user.role === "store_manager") return true;
    return row.created_by === user.id;
  });
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.deal_id) rows = rows.filter((row) => row.deal_id === payload.deal_id);
  return { ok: true, data: rows };
}

export function createRename(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const deal = getVisibleDeal(db, user, payload.deal_id);
  if (!deal) return { ok: false, message: "成交单不存在或无权限", code: 403 };
  if (deal.status !== "approved")
    return { ok: false, message: "仅已审批成交可申请更名" };
  if (!RENAME_TARGETS.has(payload.target))
    return { ok: false, message: "更名对象无效" };
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "更名原因至少 2 个字" };
  const pending = db
    .prepare(
      `SELECT id FROM deal_renames
       WHERE deal_id=? AND status IN ('draft','submitted')`
    )
    .get(deal.id) as any;
  if (pending) return { ok: false, message: "该成交已有进行中的更名申请", code: 409 };
  const customer = db
    .prepare(`SELECT name FROM customers WHERE id=?`)
    .get(deal.customer_id) as any;
  const house = db
    .prepare(`SELECT owner_name FROM houses WHERE id=?`)
    .get(deal.house_id) as any;
  const newCustomerName = String(payload.new_customer_name || "").trim();
  const newOwnerName = String(payload.new_owner_name || "").trim();
  if (["customer", "both"].includes(payload.target)) {
    if (newCustomerName.length < 2)
      return { ok: false, message: "新客户姓名至少 2 个字" };
    if (newCustomerName === customer.name)
      return { ok: false, message: "新客户姓名未变化" };
  }
  if (["owner", "both"].includes(payload.target)) {
    if (newOwnerName.length < 2)
      return { ok: false, message: "新业主姓名至少 2 个字" };
    if (newOwnerName === house.owner_name)
      return { ok: false, message: "新业主姓名未变化" };
  }
  const id = nextId("DRN");
  const now = nowIso();
  db.prepare(
    `INSERT INTO deal_renames(
       id, company_id, store_id, deal_id, target,
       old_customer_name, new_customer_name, old_owner_name, new_owner_name,
       reason, status, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    deal.store_id,
    deal.id,
    payload.target,
    customer.name,
    ["customer", "both"].includes(payload.target) ? newCustomerName : null,
    house.owner_name,
    ["owner", "both"].includes(payload.target) ? newOwnerName : null,
    reason,
    user.id,
    now,
    now
  );
  addEvent(db, user, "rename", id, "created", { target: payload.target });
  writeAudit(db, user, "dealExt.rename.create", "deal_rename", id);
  return { ok: true, data: { id, status: "draft" } };
}

export function submitRename(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM deal_renames WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "更名申请不存在", code: 404 };
  if (row.created_by !== user.id && !canManageStore(user, row.store_id))
    return { ok: false, message: "无提交权限", code: 403 };
  if (!["draft", "rejected"].includes(row.status))
    return { ok: false, message: "当前状态不可提交" };
  const materials = db
    .prepare(
      `SELECT id FROM file_attachments
       WHERE parent_type='deal_rename' AND parent_id=? AND category='rename_evidence'`
    )
    .all(row.id) as any[];
  if (!materials.length)
    return { ok: false, message: "提交前须上传更名证明材料" };
  const now = nowIso();
  db.prepare(
    `UPDATE deal_renames
     SET status='submitted', reject_reason=NULL, submitted_at=?, updated_at=? WHERE id=?`
  ).run(now, now, row.id);
  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND status='active'
       AND (role='admin' OR (role='store_manager' AND store_id=?))`
    )
    .all(user.company_id, row.store_id) as any[];
  for (const manager of managers) {
    if (manager.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: manager.id,
      title: "成交更名待审批",
      body: row.reason,
      kind: "deal_rename",
      ref_type: "deal_rename",
      ref_id: row.id,
    });
  }
  addEvent(db, user, "rename", row.id, "submitted");
  writeAudit(db, user, "dealExt.rename.submit", "deal_rename", row.id);
  return { ok: true, data: { id: row.id, status: "submitted" } };
}

export function approveRename(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM deal_renames WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManageStore(user, row.store_id))
    return { ok: false, message: "更名申请不存在或无权限", code: 403 };
  if (row.status !== "submitted")
    return { ok: false, message: "仅待审批更名可批准" };
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`)
    .get(row.deal_id, user.company_id) as any;
  if (!deal || deal.status !== "approved")
    return { ok: false, message: "关联成交不可更名" };
  const now = nowIso();
  const tx = db.transaction(() => {
    if (["customer", "both"].includes(row.target) && row.new_customer_name) {
      db.prepare(
        `UPDATE customers SET name=?, updated_at=? WHERE id=? AND company_id=?`
      ).run(row.new_customer_name, now, deal.customer_id, user.company_id);
    }
    if (["owner", "both"].includes(row.target) && row.new_owner_name) {
      db.prepare(
        `UPDATE houses SET owner_name=?, updated_at=? WHERE id=? AND company_id=?`
      ).run(row.new_owner_name, now, deal.house_id, user.company_id);
    }
    db.prepare(
      `UPDATE deal_renames
       SET status='approved', approved_by=?, approved_at=?, updated_at=? WHERE id=?`
    ).run(user.id, now, now, row.id);
  });
  tx();
  if (row.created_by !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.created_by,
      title: "成交更名已审批",
      body: row.reason,
      kind: "deal_rename",
      ref_type: "deal_rename",
      ref_id: row.id,
    });
  }
  addEvent(db, user, "rename", row.id, "approved", {
    new_customer_name: row.new_customer_name,
    new_owner_name: row.new_owner_name,
  });
  writeAudit(db, user, "dealExt.rename.approve", "deal_rename", row.id);
  return { ok: true, data: { id: row.id, status: "approved" } };
}

export function rejectRename(db: Db, user: SessionUser, payload: any): ApiResult {
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "驳回原因至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM deal_renames WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManageStore(user, row.store_id))
    return { ok: false, message: "更名申请不存在或无权限", code: 403 };
  if (row.status !== "submitted")
    return { ok: false, message: "仅待审批更名可驳回" };
  const now = nowIso();
  db.prepare(
    `UPDATE deal_renames
     SET status='rejected', reject_reason=?, updated_at=? WHERE id=?`
  ).run(reason, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.created_by,
    title: "成交更名已驳回",
    body: reason,
    kind: "deal_rename",
    ref_type: "deal_rename",
    ref_id: row.id,
  });
  addEvent(db, user, "rename", row.id, "rejected", { reason });
  writeAudit(db, user, "dealExt.rename.reject", "deal_rename", row.id, { reason });
  return { ok: true, data: { id: row.id, status: "rejected" } };
}

export function cancelRename(db: Db, user: SessionUser, payload: any): ApiResult {
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "取消原因至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM deal_renames WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "更名申请不存在", code: 404 };
  if (row.created_by !== user.id && !canManageStore(user, row.store_id))
    return { ok: false, message: "无取消权限", code: 403 };
  if (!["draft", "rejected"].includes(row.status))
    return { ok: false, message: "当前状态不可取消" };
  const now = nowIso();
  db.prepare(
    `UPDATE deal_renames
     SET status='cancelled', reject_reason=?, updated_at=? WHERE id=?`
  ).run(reason, now, row.id);
  addEvent(db, user, "rename", row.id, "cancelled", { reason });
  writeAudit(db, user, "dealExt.rename.cancel", "deal_rename", row.id, { reason });
  if (row.created_by && row.created_by !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.created_by,
      title: "成交更名已取消",
      body: `${row.reason} · ${reason}`,
      kind: "deal_rename",
      ref_type: "deal_rename",
      ref_id: row.id,
    });
  }
  return { ok: true, data: { id: row.id, status: "cancelled" } };
}
