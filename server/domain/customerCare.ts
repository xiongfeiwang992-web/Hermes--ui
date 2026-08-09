import type { Db } from "../db/database";
import { customerVisibleTo, maskPhone } from "../auth/policy";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const CASE_TYPES = new Set(["complaint", "lawsuit"]);
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const TASK_TYPES = new Set(["survey", "callback"]);

function canManageStore(user: SessionUser, storeId: string): boolean {
  return user.role === "admin" || (user.role === "store_manager" && user.store_id === storeId);
}

function caseVisible(user: SessionUser, row: any): boolean {
  if (user.role === "finance") return false;
  if (canManageStore(user, row.store_id)) return true;
  return row.created_by === user.id || row.assignee_user_id === user.id;
}

function taskVisible(user: SessionUser, row: any): boolean {
  if (user.role === "finance") return false;
  if (canManageStore(user, row.store_id)) return true;
  return row.created_by === user.id || row.assignee_user_id === user.id;
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
    `INSERT INTO customer_care_events(
      id, company_id, entity_type, entity_id, event_type, details, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("CCE"),
    user.company_id,
    entityType,
    entityId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function presentPhone(user: SessionUser, row: any) {
  const canSee =
    user.role === "admin" ||
    (user.role === "store_manager" && user.store_id === row.store_id) ||
    row.customer_agent_id === user.id;
  return { ...row, customer_phone: canSee ? row.customer_phone : maskPhone(row.customer_phone) };
}

function refreshOverdue(db: Db, companyId: string) {
  db.prepare(
    `UPDATE customer_care_tasks SET status='overdue', updated_at=?
     WHERE company_id=? AND status='pending' AND due_at<?`
  ).run(nowIso(), companyId, nowIso());
}

export function careOptions(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance")
    return { ok: true, data: { customers: [], deals: [], users: [] } };
  let customers = db
    .prepare(
      `SELECT id, store_id, name, phone, agent_id, visibility, is_confidential
       FROM customers WHERE company_id=? AND status NOT IN ('invalid', 'merged')
       ORDER BY updated_at DESC`
    )
    .all(user.company_id) as any[];
  customers = customers
    .filter((customer) => customerVisibleTo(user, customer))
    .map((customer) => ({
      ...customer,
      phone:
        user.role === "admin" ||
        user.role === "store_manager" ||
        customer.agent_id === user.id
          ? customer.phone
          : maskPhone(customer.phone),
    }));
  const customerIds = new Set(customers.map((customer) => customer.id));
  let deals = db
    .prepare(
      `SELECT id, store_id, customer_id, deal_type, contract_price, status
       FROM deals WHERE company_id=? ORDER BY created_at DESC`
    )
    .all(user.company_id) as any[];
  deals = deals.filter((deal) => customerIds.has(deal.customer_id));
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' AND role<>'finance'
       ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  if (user.role !== "admin") users = users.filter((row) => row.store_id === user.store_id);
  return { ok: true, data: { customers, deals, users } };
}

export function listCases(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: true, data: [] };
  let rows = db
    .prepare(
      `SELECT c.*, customer.name AS customer_name, customer.phone AS customer_phone,
       customer.agent_id AS customer_agent_id, creator.display_name AS creator_name,
       assignee.display_name AS assignee_name, s.name AS store_name,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='customer_care_case' AND a.parent_id=c.id) AS attachment_count
       FROM customer_care_cases c
       JOIN customers customer ON customer.id=c.customer_id
       JOIN users creator ON creator.id=c.created_by
       LEFT JOIN users assignee ON assignee.id=c.assignee_user_id
       JOIN stores s ON s.id=c.store_id
       WHERE c.company_id=? ORDER BY c.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => caseVisible(user, row));
  if (payload.case_type) rows = rows.filter((row) => row.case_type === payload.case_type);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.customer_id)
    rows = rows.filter((row) => row.customer_id === payload.customer_id);
  return { ok: true, data: rows.map((row) => presentPhone(user, row)) };
}

export function createCase(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "财务无客户关怀权限", code: 403 };
  if (!CASE_TYPES.has(payload.case_type)) return { ok: false, message: "案件类型无效" };
  if (payload.case_type === "lawsuit" && !["admin", "store_manager"].includes(user.role))
    return { ok: false, message: "仅管理员或店长可登记诉讼", code: 403 };
  if (!SEVERITIES.has(payload.severity)) return { ok: false, message: "严重程度无效" };
  const title = String(payload.title || "").trim();
  const description = String(payload.description || "").trim();
  if (!title || !description) return { ok: false, message: "案件标题和描述必填" };
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id=? AND company_id=?`)
    .get(payload.customer_id, user.company_id) as any;
  if (!customer || !customerVisibleTo(user, customer))
    return { ok: false, message: "客户不存在或无权限", code: 403 };
  if (payload.deal_id) {
    const deal = db
      .prepare(`SELECT id FROM deals WHERE id=? AND company_id=? AND customer_id=?`)
      .get(payload.deal_id, user.company_id, customer.id);
    if (!deal) return { ok: false, message: "关联成交不属于该客户" };
  }
  const legalCaseNo = String(payload.legal_case_no || "").trim();
  const courtName = String(payload.court_name || "").trim();
  if (payload.case_type === "lawsuit" && (!legalCaseNo || !courtName))
    return { ok: false, message: "诉讼案号和法院必填" };
  const id = nextId("CCC");
  const now = nowIso();
  db.prepare(
    `INSERT INTO customer_care_cases(
      id, company_id, store_id, customer_id, deal_id, case_type, title,
      description, severity, status, legal_case_no, court_name,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    customer.store_id,
    customer.id,
    payload.deal_id || null,
    payload.case_type,
    title,
    description,
    payload.severity,
    legalCaseNo || null,
    courtName || null,
    user.id,
    now,
    now
  );
  addEvent(db, user, "case", id, "created", { case_type: payload.case_type });
  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND status='active'
       AND (role='admin' OR (role='store_manager' AND store_id=?))`
    )
    .all(user.company_id, customer.store_id) as any[];
  for (const manager of managers) {
    if (manager.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: customer.store_id,
      user_id: manager.id,
      title: payload.case_type === "lawsuit" ? "新诉讼案件" : "新客户投诉",
      body: title,
      kind: "customer_care",
      ref_type: "customer_care_case",
      ref_id: id,
    });
  }
  writeAudit(db, user, `customer_care.${payload.case_type}.create`, "customer_care_case", id);
  return { ok: true, data: { id, status: "open" } };
}

export function assignCase(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM customer_care_cases WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManageStore(user, row.store_id))
    return { ok: false, message: "案件不存在或无分派权限", code: 403 };
  if (!["open", "assigned", "investigating"].includes(row.status))
    return { ok: false, message: "当前案件不可分派" };
  const assignee = db
    .prepare(
      `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=?
       AND status='active' AND role<>'finance'`
    )
    .get(payload.assignee_user_id, user.company_id, row.store_id);
  if (!assignee) return { ok: false, message: "处理人必须为同店在职员工" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.due_date || "")))
    return { ok: false, message: "处理期限无效" };
  db.prepare(
    `UPDATE customer_care_cases SET assignee_user_id=?, due_date=?,
     status='assigned', updated_at=? WHERE id=?`
  ).run(payload.assignee_user_id, payload.due_date, nowIso(), row.id);
  addEvent(db, user, "case", row.id, "assigned", {
    assignee_user_id: payload.assignee_user_id,
    due_date: payload.due_date,
  });
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: payload.assignee_user_id,
    title: row.case_type === "lawsuit" ? "诉讼案件已分派" : "客户投诉已分派",
    body: row.title,
    kind: "customer_care",
    ref_type: "customer_care_case",
    ref_id: row.id,
  });
  writeAudit(db, user, "customer_care.case.assign", "customer_care_case", row.id);
  return { ok: true, data: { id: row.id, status: "assigned" } };
}

export function investigateCase(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM customer_care_cases WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (
    !row ||
    !(canManageStore(user, row.store_id) || row.assignee_user_id === user.id)
  )
    return { ok: false, message: "案件不存在或无处理权限", code: 403 };
  if (row.status !== "assigned") return { ok: false, message: "仅已分派案件可开始调查" };
  db.prepare(
    `UPDATE customer_care_cases SET status='investigating', updated_at=? WHERE id=?`
  ).run(nowIso(), row.id);
  addEvent(db, user, "case", row.id, "investigating");
  writeAudit(db, user, "customer_care.case.investigate", "customer_care_case", row.id);
  return { ok: true, data: { id: row.id, status: "investigating" } };
}

export function resolveCase(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM customer_care_cases WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (
    !row ||
    !(canManageStore(user, row.store_id) || row.assignee_user_id === user.id)
  )
    return { ok: false, message: "案件不存在或无处理权限", code: 403 };
  if (!["assigned", "investigating"].includes(row.status))
    return { ok: false, message: "当前案件不可解决" };
  const resolution = String(payload.resolution || "").trim();
  if (!resolution) return { ok: false, message: "解决方案必填" };
  const requiredCategory =
    row.case_type === "lawsuit" ? "legal_document" : "complaint_evidence";
  const attachment = db
    .prepare(
      `SELECT id FROM file_attachments WHERE parent_type='customer_care_case'
       AND parent_id=? AND category=? LIMIT 1`
    )
    .get(row.id, requiredCategory);
  if (!attachment)
    return {
      ok: false,
      message: row.case_type === "lawsuit" ? "请先上传诉讼文书" : "请先上传投诉处理凭证",
    };
  const now = nowIso();
  db.prepare(
    `UPDATE customer_care_cases SET status='resolved', resolution=?,
     resolved_at=?, updated_at=? WHERE id=?`
  ).run(resolution, now, now, row.id);
  addEvent(db, user, "case", row.id, "resolved", { resolution });
  writeAudit(db, user, "customer_care.case.resolve", "customer_care_case", row.id);
  return { ok: true, data: { id: row.id, status: "resolved" } };
}

export function closeCase(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM customer_care_cases WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManageStore(user, row.store_id))
    return { ok: false, message: "案件不存在或无结案权限", code: 403 };
  if (row.status !== "resolved") return { ok: false, message: "仅已解决案件可结案" };
  const now = nowIso();
  db.prepare(
    `UPDATE customer_care_cases SET status='closed', closed_at=?, updated_at=? WHERE id=?`
  ).run(now, now, row.id);
  addEvent(db, user, "case", row.id, "closed");
  if (row.created_by !== user.id)
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.created_by,
      title: "客户关怀案件已结案",
      body: row.title,
      kind: "customer_care",
      ref_type: "customer_care_case",
      ref_id: row.id,
    });
  writeAudit(db, user, "customer_care.case.close", "customer_care_case", row.id);
  return { ok: true, data: { id: row.id, status: "closed" } };
}

export function withdrawCase(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM customer_care_cases WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.created_by !== user.id)
    return { ok: false, message: "案件不存在或无撤回权限", code: 403 };
  if (row.status !== "open") return { ok: false, message: "仅未分派案件可撤回" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "撤回原因必填" };
  db.prepare(
    `UPDATE customer_care_cases SET status='withdrawn', resolution=?,
     updated_at=? WHERE id=?`
  ).run(reason, nowIso(), row.id);
  addEvent(db, user, "case", row.id, "withdrawn", { reason });
  writeAudit(db, user, "customer_care.case.withdraw", "customer_care_case", row.id);
  return { ok: true, data: { id: row.id, status: "withdrawn" } };
}

export function listTasks(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  refreshOverdue(db, user.company_id);
  if (user.role === "finance") return { ok: true, data: [] };
  let rows = db
    .prepare(
      `SELECT t.*, customer.name AS customer_name, customer.phone AS customer_phone,
       customer.agent_id AS customer_agent_id, assignee.display_name AS assignee_name,
       creator.display_name AS creator_name, s.name AS store_name
       FROM customer_care_tasks t
       JOIN customers customer ON customer.id=t.customer_id
       JOIN users assignee ON assignee.id=t.assignee_user_id
       JOIN users creator ON creator.id=t.created_by
       JOIN stores s ON s.id=t.store_id
       WHERE t.company_id=? ORDER BY t.due_at, t.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => taskVisible(user, row));
  if (payload.task_type) rows = rows.filter((row) => row.task_type === payload.task_type);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.customer_id)
    rows = rows.filter((row) => row.customer_id === payload.customer_id);
  return { ok: true, data: rows.map((row) => presentPhone(user, row)) };
}

export function createTask(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "财务无客户关怀权限", code: 403 };
  if (!TASK_TYPES.has(payload.task_type)) return { ok: false, message: "关怀任务类型无效" };
  const isManagerial = user.role === "admin" || user.role === "store_manager";
  if (payload.task_type === "survey" && !isManagerial)
    return { ok: false, message: "仅管理员或店长可发起满意度调查", code: 403 };
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id=? AND company_id=?`)
    .get(payload.customer_id, user.company_id) as any;
  if (!customer || !customerVisibleTo(user, customer))
    return { ok: false, message: "客户不存在或无权限", code: 403 };
  const purpose = String(payload.purpose || "").trim();
  if (!purpose) return { ok: false, message: "调查或回访目的必填" };
  const dueAt = String(payload.due_at || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dueAt))
    return { ok: false, message: "计划完成时间无效" };
  const assigneeId = isManagerial ? payload.assignee_user_id : user.id;
  const assignee = db
    .prepare(
      `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=?
       AND status='active' AND role<>'finance'`
    )
    .get(assigneeId, user.company_id, customer.store_id);
  if (!assignee) return { ok: false, message: "执行人必须为客户同店在职员工" };
  if (payload.case_id) {
    const careCase = db
      .prepare(
        `SELECT id FROM customer_care_cases WHERE id=? AND company_id=?
         AND customer_id=?`
      )
      .get(payload.case_id, user.company_id, customer.id);
    if (!careCase) return { ok: false, message: "关联案件不属于该客户" };
  }
  const duplicate = db
    .prepare(
      `SELECT id FROM customer_care_tasks WHERE customer_id=? AND task_type=?
       AND status IN ('pending', 'overdue')`
    )
    .get(customer.id, payload.task_type);
  if (duplicate) return { ok: false, message: "该客户已有未完成的同类任务" };
  const id = nextId("CCT");
  const now = nowIso();
  db.prepare(
    `INSERT INTO customer_care_tasks(
      id, company_id, store_id, customer_id, case_id, task_type, purpose,
      assignee_user_id, due_at, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    customer.store_id,
    customer.id,
    payload.case_id || null,
    payload.task_type,
    purpose,
    assigneeId,
    dueAt,
    user.id,
    now,
    now
  );
  addEvent(db, user, "task", id, "created", { task_type: payload.task_type });
  if (assigneeId !== user.id)
    createMessage(db, {
      company_id: user.company_id,
      store_id: customer.store_id,
      user_id: assigneeId,
      title: payload.task_type === "survey" ? "新满意度调查" : "新客户回访",
      body: `${customer.name}：${purpose}`,
      kind: "customer_care",
      ref_type: "customer_care_task",
      ref_id: id,
    });
  writeAudit(db, user, `customer_care.${payload.task_type}.create`, "customer_care_task", id);
  return { ok: true, data: { id, status: "pending" } };
}

export function completeTask(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM customer_care_tasks WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (
    !row ||
    !(canManageStore(user, row.store_id) || row.assignee_user_id === user.id)
  )
    return { ok: false, message: "任务不存在或无完成权限", code: 403 };
  if (!["pending", "overdue"].includes(row.status))
    return { ok: false, message: "当前任务不可完成" };
  const result = String(payload.result || "").trim();
  if (!result) return { ok: false, message: "调查或回访结果必填" };
  const score = payload.satisfaction_score == null ? null : Number(payload.satisfaction_score);
  if (row.task_type === "survey" && (!Number.isInteger(score) || score! < 1 || score! > 5))
    return { ok: false, message: "满意度调查必须填写 1 至 5 分" };
  if (score != null && (!Number.isInteger(score) || score < 1 || score > 5))
    return { ok: false, message: "满意度评分必须为 1 至 5 分" };
  const now = nowIso();
  db.prepare(
    `UPDATE customer_care_tasks SET status='completed', result=?,
     satisfaction_score=?, completed_at=?, updated_at=? WHERE id=?`
  ).run(result, score, now, now, row.id);
  addEvent(db, user, "task", row.id, "completed", {
    satisfaction_score: score,
  });
  writeAudit(db, user, "customer_care.task.complete", "customer_care_task", row.id);
  return { ok: true, data: { id: row.id, status: "completed" } };
}

export function cancelTask(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(
      `SELECT t.*, c.name AS customer_name
       FROM customer_care_tasks t
       JOIN customers c ON c.id=t.customer_id
       WHERE t.id=? AND t.company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (
    !row ||
    !(canManageStore(user, row.store_id) || row.created_by === user.id)
  )
    return { ok: false, message: "任务不存在或无取消权限", code: 403 };
  if (!["pending", "overdue"].includes(row.status))
    return { ok: false, message: "当前任务不可取消" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "取消原因必填" };
  db.prepare(
    `UPDATE customer_care_tasks SET status='cancelled', cancel_reason=?,
     updated_at=? WHERE id=?`
  ).run(reason, nowIso(), row.id);
  addEvent(db, user, "task", row.id, "cancelled", { reason });
  writeAudit(db, user, "customer_care.task.cancel", "customer_care_task", row.id, {
    reason,
  });
  if (row.assignee_user_id && row.assignee_user_id !== user.id) {
    const typeLabel = row.task_type === "survey" ? "满意度调查" : "客户回访";
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.assignee_user_id,
      title: "客户关怀任务已取消",
      body: `${row.customer_name} · ${typeLabel}：${reason}`,
      kind: "customer_care",
      ref_type: "customer_care_task",
      ref_id: row.id,
    });
  }
  return {
    ok: true,
    data: { id: row.id, status: "cancelled", cancel_reason: reason },
  };
}

export function listCareEvents(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!["case", "task"].includes(payload.entity_type))
    return { ok: false, message: "履历对象类型无效" };
  const row =
    payload.entity_type === "case"
      ? (db
          .prepare(`SELECT * FROM customer_care_cases WHERE id=? AND company_id=?`)
          .get(payload.entity_id, user.company_id) as any)
      : (db
          .prepare(`SELECT * FROM customer_care_tasks WHERE id=? AND company_id=?`)
          .get(payload.entity_id, user.company_id) as any);
  const visible = row && (payload.entity_type === "case" ? caseVisible(user, row) : taskVisible(user, row));
  if (!visible) return { ok: false, message: "履历对象不存在或无权限", code: 403 };
  const events = db
    .prepare(
      `SELECT e.*, u.display_name AS created_by_name FROM customer_care_events e
       JOIN users u ON u.id=e.created_by
       WHERE e.company_id=? AND e.entity_type=? AND e.entity_id=?
       ORDER BY e.created_at DESC`
    )
    .all(user.company_id, payload.entity_type, payload.entity_id);
  return { ok: true, data: events };
}
