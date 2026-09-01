import type { Db } from "../db/database";
import { maskPhone } from "../auth/policy";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const TICKET_TYPES = new Set(["receipt", "invoice", "contract_blank", "other"]);

function addEvent(
  db: Db,
  user: SessionUser,
  entityType: string,
  entityId: string,
  eventType: string,
  details: unknown = {}
) {
  db.prepare(
    `INSERT INTO office_collab_events(
      id, company_id, entity_type, entity_id, event_type, details, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("OCE"),
    user.company_id,
    entityType,
    entityId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function canManage(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "store_manager";
}

function scopeOk(user: SessionUser, storeId: string | null): boolean {
  if (user.role === "admin") return true;
  if (!storeId) return true;
  return storeId === user.store_id;
}

export function officeCollabOptions(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance")
    return { ok: true, data: { users: [], houses: [], customers: [] } };
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' AND role<>'finance'
       ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  let houses = db
    .prepare(
      `SELECT id, store_id, title, owner_phone FROM houses
       WHERE company_id=? AND status NOT IN ('closed','withdrawn') ORDER BY updated_at DESC`
    )
    .all(user.company_id) as any[];
  let customers = db
    .prepare(
      `SELECT id, store_id, name, phone, agent_id FROM customers
       WHERE company_id=? AND status NOT IN ('closed') ORDER BY updated_at DESC`
    )
    .all(user.company_id) as any[];
  if (user.role !== "admin") {
    users = users.filter((row) => row.store_id === user.store_id);
    houses = houses.filter((row) => row.store_id === user.store_id);
    customers = customers.filter(
      (row) =>
        row.store_id === user.store_id &&
        (user.role === "store_manager" || row.agent_id === user.id)
    );
  }
  return { ok: true, data: { users, houses, customers } };
}

export function listExams(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT e.*,
        (SELECT COUNT(*) FROM office_exam_attempts a WHERE a.exam_id=e.id) AS attempt_count
       FROM office_exams e WHERE e.company_id=? ORDER BY e.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter(
    (row) =>
      scopeOk(user, row.store_id) &&
      (canManage(user) || row.status === "published" || row.created_by === user.id)
  );
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function saveExam(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const title = String(payload.title || "").trim();
  if (title.length < 2) return { ok: false, message: "考试标题至少 2 个字" };
  const passScore = Number(payload.pass_score ?? 60);
  const duration = Number(payload.duration_minutes ?? 60);
  if (!Number.isFinite(passScore) || passScore < 0 || passScore > 100)
    return { ok: false, message: "及格分须为 0～100" };
  if (!Number.isInteger(duration) || duration < 1 || duration > 600)
    return { ok: false, message: "考试时长须为 1～600 分钟" };
  const storeId = user.role === "admin" ? payload.store_id || null : user.store_id;
  const now = nowIso();
  if (payload.id) {
    const row = db
      .prepare(`SELECT * FROM office_exams WHERE id=? AND company_id=?`)
      .get(payload.id, user.company_id) as any;
    if (!row || !scopeOk(user, row.store_id))
      return { ok: false, message: "考试不存在或无权限", code: 403 };
    if (row.status === "closed") return { ok: false, message: "已关闭考试不可修改" };
    db.prepare(
      `UPDATE office_exams
       SET title=?, description=?, pass_score=?, duration_minutes=?, store_id=?, updated_at=?
       WHERE id=?`
    ).run(
      title,
      String(payload.description || "").trim() || null,
      passScore,
      duration,
      storeId,
      now,
      row.id
    );
    writeAudit(db, user, "officeCollab.exam.update", "office_exam", row.id);
    return { ok: true, data: { id: row.id } };
  }
  const id = nextId("OEX");
  db.prepare(
    `INSERT INTO office_exams(
       id, company_id, store_id, title, description, pass_score, duration_minutes,
       status, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    storeId,
    title,
    String(payload.description || "").trim() || null,
    passScore,
    duration,
    user.id,
    now,
    now
  );
  addEvent(db, user, "exam", id, "created");
  writeAudit(db, user, "officeCollab.exam.create", "office_exam", id);
  return { ok: true, data: { id, status: "draft" } };
}

export function publishExam(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM office_exams WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !scopeOk(user, row.store_id))
    return { ok: false, message: "考试不存在或无权限", code: 403 };
  if (!["draft", "closed"].includes(row.status))
    return { ok: false, message: "当前状态不可发布" };
  db.prepare(`UPDATE office_exams SET status='published', updated_at=? WHERE id=?`).run(
    nowIso(),
    row.id
  );
  addEvent(db, user, "exam", row.id, "published");
  writeAudit(db, user, "officeCollab.exam.publish", "office_exam", row.id);
  return { ok: true, data: { id: row.id, status: "published" } };
}

export function submitExamAttempt(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const exam = db
    .prepare(`SELECT * FROM office_exams WHERE id=? AND company_id=?`)
    .get(payload.exam_id, user.company_id) as any;
  if (!exam || exam.status !== "published" || !scopeOk(user, exam.store_id))
    return { ok: false, message: "考试不可参加", code: 403 };
  const score = Number(payload.score);
  if (!Number.isFinite(score) || score < 0 || score > 100)
    return { ok: false, message: "成绩须为 0～100" };
  const existing = db
    .prepare(
      `SELECT id FROM office_exam_attempts WHERE exam_id=? AND user_id=?`
    )
    .get(exam.id, user.id) as any;
  if (existing) return { ok: false, message: "已提交过该考试", code: 409 };
  const id = nextId("OEA");
  const now = nowIso();
  const passed = score >= exam.pass_score ? 1 : 0;
  db.prepare(
    `INSERT INTO office_exam_attempts(
       id, company_id, exam_id, user_id, score, passed, status, submitted_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)`
  ).run(id, user.company_id, exam.id, user.id, score, passed, now);
  addEvent(db, user, "exam", exam.id, "attempt", { score, passed: !!passed });
  writeAudit(db, user, "officeCollab.exam.attempt", "office_exam_attempt", id);
  return { ok: true, data: { id, score, passed: !!passed } };
}

export function listEvents(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT e.*,
        (SELECT COUNT(*) FROM office_event_signups s
         WHERE s.event_id=e.id AND s.status='signed') AS signup_count
       FROM office_events e WHERE e.company_id=? ORDER BY e.start_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter(
    (row) =>
      scopeOk(user, row.store_id) &&
      (canManage(user) ||
        ["open", "closed"].includes(row.status) ||
        row.created_by === user.id)
  );
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function saveEvent(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const title = String(payload.title || "").trim();
  if (title.length < 2) return { ok: false, message: "活动标题至少 2 个字" };
  const startAt = String(payload.start_at || "").trim();
  const endAt = String(payload.end_at || "").trim();
  if (!startAt || !endAt || endAt < startAt)
    return { ok: false, message: "活动起止时间无效" };
  const capacity =
    payload.capacity === undefined || payload.capacity === null || payload.capacity === ""
      ? null
      : Number(payload.capacity);
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1))
    return { ok: false, message: "名额须为正整数" };
  const storeId = user.role === "admin" ? payload.store_id || null : user.store_id;
  const now = nowIso();
  const id = nextId("OEV");
  db.prepare(
    `INSERT INTO office_events(
       id, company_id, store_id, title, location, start_at, end_at, capacity,
       status, remark, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    storeId,
    title,
    String(payload.location || "").trim() || null,
    startAt,
    endAt,
    capacity,
    String(payload.remark || "").trim() || null,
    user.id,
    now,
    now
  );
  addEvent(db, user, "event", id, "created");
  writeAudit(db, user, "officeCollab.event.create", "office_event", id);
  return { ok: true, data: { id, status: "draft" } };
}

export function openEvent(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM office_events WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !scopeOk(user, row.store_id))
    return { ok: false, message: "活动不存在或无权限", code: 403 };
  if (row.status !== "draft") return { ok: false, message: "仅草稿可开放报名" };
  db.prepare(`UPDATE office_events SET status='open', updated_at=? WHERE id=?`).run(
    nowIso(),
    row.id
  );
  let recipients = db
    .prepare(
      `SELECT id, store_id FROM users
       WHERE company_id=? AND status='active' AND id<>? AND role<>'finance'`
    )
    .all(user.company_id, user.id) as any[];
  if (row.store_id)
    recipients = recipients.filter((recipient) => recipient.store_id === row.store_id);
  const when = String(row.start_at || "").slice(0, 16).replace("T", " ");
  const body = row.location
    ? `${row.title} · ${when} · ${row.location}`
    : `${row.title} · ${when}`;
  for (const recipient of recipients) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id || recipient.store_id,
      user_id: recipient.id,
      title: "活动开放报名",
      body,
      kind: "business_record_status",
      ref_type: "office_event",
      ref_id: row.id,
    });
  }
  addEvent(db, user, "event", row.id, "opened");
  writeAudit(db, user, "officeCollab.event.open", "office_event", row.id);
  return { ok: true, data: { id: row.id, status: "open" } };
}

export function signupEvent(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM office_events WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.status !== "open" || !scopeOk(user, row.store_id))
    return { ok: false, message: "活动不可报名", code: 403 };
  const signed = db
    .prepare(
      `SELECT COUNT(*) AS c FROM office_event_signups
       WHERE event_id=? AND status='signed'`
    )
    .get(row.id) as any;
  if (row.capacity != null && Number(signed.c) >= row.capacity)
    return { ok: false, message: "报名名额已满", code: 409 };
  const existing = db
    .prepare(`SELECT * FROM office_event_signups WHERE event_id=? AND user_id=?`)
    .get(row.id, user.id) as any;
  const now = nowIso();
  if (existing) {
    if (existing.status === "signed")
      return { ok: false, message: "已报名该活动", code: 409 };
    db.prepare(
      `UPDATE office_event_signups
       SET status='signed', signed_at=?, cancelled_at=NULL WHERE id=?`
    ).run(now, existing.id);
    return { ok: true, data: { id: existing.id, status: "signed" } };
  }
  const id = nextId("OES");
  db.prepare(
    `INSERT INTO office_event_signups(
       id, company_id, event_id, user_id, status, signed_at
     ) VALUES (?, ?, ?, ?, 'signed', ?)`
  ).run(id, user.company_id, row.id, user.id, now);
  addEvent(db, user, "event", row.id, "signup");
  writeAudit(db, user, "officeCollab.event.signup", "office_event_signup", id);
  return { ok: true, data: { id, status: "signed" } };
}

export function listWorkflows(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT w.*, u.display_name AS created_by_name,
        (SELECT COUNT(*) FROM office_workflow_approvers a WHERE a.workflow_id=w.id) AS approver_count,
        (SELECT COUNT(*) FROM office_workflow_approvers a
         WHERE a.workflow_id=w.id AND a.status='approved') AS approved_count
       FROM office_workflows w
       JOIN users u ON u.id=w.created_by
       WHERE w.company_id=? ORDER BY w.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    if (user.role === "admin") return true;
    if (row.store_id !== user.store_id) return false;
    if (user.role === "store_manager" || row.created_by === user.id) return true;
    const mine = db
      .prepare(
        `SELECT id FROM office_workflow_approvers WHERE workflow_id=? AND user_id=?`
      )
      .get(row.id, user.id);
    return Boolean(mine);
  });
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function createWorkflow(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const title = String(payload.title || "").trim();
  const content = String(payload.content || "").trim();
  if (title.length < 2 || content.length < 2)
    return { ok: false, message: "会签标题和内容至少 2 个字" };
  const approverIds: string[] = Array.isArray(payload.approver_user_ids)
    ? payload.approver_user_ids.map(String)
    : [];
  if (!approverIds.length) return { ok: false, message: "至少指定一名会签人" };
  const unique = [...new Set(approverIds)];
  if (unique.includes(user.id))
    return { ok: false, message: "发起人不能作为会签人" };
  for (const approverId of unique) {
    const approver = db
      .prepare(
        `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=?
         AND status='active' AND role<>'finance'`
      )
      .get(approverId, user.company_id, user.store_id);
    if (!approver) return { ok: false, message: "会签人须为同店在职员工" };
  }
  const id = nextId("OWF");
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO office_workflows(
         id, company_id, store_id, title, content, status, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
    ).run(id, user.company_id, user.store_id, title, content, user.id, now, now);
    unique.forEach((approverId, index) => {
      db.prepare(
        `INSERT INTO office_workflow_approvers(
           id, company_id, workflow_id, user_id, sort_order, status
         ) VALUES (?, ?, ?, ?, ?, 'pending')`
      ).run(nextId("OWA"), user.company_id, id, approverId, index + 1);
    });
  });
  tx();
  addEvent(db, user, "workflow", id, "created");
  writeAudit(db, user, "officeCollab.workflow.create", "office_workflow", id);
  return { ok: true, data: { id, status: "draft" } };
}

export function submitWorkflow(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM office_workflows WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.created_by !== user.id)
    return { ok: false, message: "会签不存在或无权限", code: 403 };
  if (row.status !== "draft") return { ok: false, message: "仅草稿可提交" };
  const now = nowIso();
  db.prepare(
    `UPDATE office_workflows
     SET status='pending', submitted_at=?, updated_at=? WHERE id=?`
  ).run(now, now, row.id);
  const approvers = db
    .prepare(`SELECT user_id FROM office_workflow_approvers WHERE workflow_id=?`)
    .all(row.id) as any[];
  for (const approver of approvers) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: approver.user_id,
      title: "待会签流程",
      body: row.title,
      kind: "office_workflow",
      ref_type: "office_workflow",
      ref_id: row.id,
    });
  }
  addEvent(db, user, "workflow", row.id, "submitted");
  writeAudit(db, user, "officeCollab.workflow.submit", "office_workflow", row.id);
  return { ok: true, data: { id: row.id, status: "pending" } };
}

export function decideWorkflow(db: Db, user: SessionUser, payload: any): ApiResult {
  const decision = payload.decision;
  if (!["approved", "rejected"].includes(decision))
    return { ok: false, message: "会签决定无效" };
  const comment = String(payload.comment || "").trim();
  if (decision === "rejected" && comment.length < 2)
    return { ok: false, message: "驳回意见至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM office_workflows WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.status !== "pending")
    return { ok: false, message: "会签不可审批", code: 403 };
  const step = db
    .prepare(
      `SELECT * FROM office_workflow_approvers
       WHERE workflow_id=? AND user_id=? AND status='pending'`
    )
    .get(row.id, user.id) as any;
  if (!step) return { ok: false, message: "你不是待处理会签人", code: 403 };
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE office_workflow_approvers
       SET status=?, comment=?, acted_at=? WHERE id=?`
    ).run(decision, comment || null, now, step.id);
    if (decision === "rejected") {
      db.prepare(
        `UPDATE office_workflows
         SET status='rejected', reject_reason=?, completed_at=?, updated_at=? WHERE id=?`
      ).run(comment, now, now, row.id);
    } else {
      const pending = db
        .prepare(
          `SELECT COUNT(*) AS c FROM office_workflow_approvers
           WHERE workflow_id=? AND status='pending'`
        )
        .get(row.id) as any;
      if (Number(pending.c) === 0) {
        db.prepare(
          `UPDATE office_workflows
           SET status='approved', completed_at=?, updated_at=? WHERE id=?`
        ).run(now, now, row.id);
      } else {
        db.prepare(`UPDATE office_workflows SET updated_at=? WHERE id=?`).run(now, row.id);
      }
    }
  });
  tx();
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.created_by,
    title: decision === "approved" ? "会签已通过一步" : "会签已驳回",
    body: comment || row.title,
    kind: "office_workflow",
    ref_type: "office_workflow",
    ref_id: row.id,
  });
  addEvent(db, user, "workflow", row.id, decision, { comment });
  writeAudit(db, user, `officeCollab.workflow.${decision}`, "office_workflow", row.id);
  const latest = db
    .prepare(`SELECT status FROM office_workflows WHERE id=?`)
    .get(row.id) as any;
  return { ok: true, data: { id: row.id, status: latest.status } };
}

export function listTickets(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT t.*, u.display_name AS applicant_name
       FROM office_tickets t
       JOIN users u ON u.id=t.applicant_user_id
       WHERE t.company_id=? ORDER BY t.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    if (user.role === "admin") return true;
    if (row.store_id !== user.store_id) return false;
    if (user.role === "store_manager") return true;
    return row.applicant_user_id === user.id;
  });
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function createTicket(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  if (!TICKET_TYPES.has(payload.ticket_type))
    return { ok: false, message: "票据类型无效" };
  const title = String(payload.title || "").trim();
  if (title.length < 2) return { ok: false, message: "票据标题至少 2 个字" };
  const quantity = Number(payload.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999)
    return { ok: false, message: "数量须为 1～999" };
  const id = nextId("OTK");
  const now = nowIso();
  db.prepare(
    `INSERT INTO office_tickets(
       id, company_id, store_id, ticket_type, title, quantity, status, remark,
       applicant_user_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    payload.ticket_type,
    title,
    quantity,
    String(payload.remark || "").trim() || null,
    user.id,
    now,
    now
  );
  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND status='active'
       AND (role='admin' OR (role='store_manager' AND store_id=?))`
    )
    .all(user.company_id, user.store_id) as any[];
  for (const manager of managers) {
    if (manager.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: user.store_id,
      user_id: manager.id,
      title: "票据申领待审批",
      body: title,
      kind: "office_ticket",
      ref_type: "office_ticket",
      ref_id: id,
    });
  }
  addEvent(db, user, "ticket", id, "created");
  writeAudit(db, user, "officeCollab.ticket.create", "office_ticket", id);
  return { ok: true, data: { id, status: "requested" } };
}

export function approveTicket(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM office_tickets WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !scopeOk(user, row.store_id))
    return { ok: false, message: "票据不存在或无权限", code: 403 };
  if (row.status !== "requested") return { ok: false, message: "仅待审批票据可批准" };
  if (row.applicant_user_id === user.id)
    return { ok: false, message: "不能审批本人申领", code: 403 };
  const now = nowIso();
  db.prepare(
    `UPDATE office_tickets
     SET status='approved', approved_by=?, approved_at=?, updated_at=? WHERE id=?`
  ).run(user.id, now, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.applicant_user_id,
    title: "票据申领已批准",
    body: row.title,
    kind: "office_ticket",
    ref_type: "office_ticket",
    ref_id: row.id,
  });
  addEvent(db, user, "ticket", row.id, "approved");
  writeAudit(db, user, "officeCollab.ticket.approve", "office_ticket", row.id);
  return { ok: true, data: { id: row.id, status: "approved" } };
}

export function issueTicket(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM office_tickets WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !scopeOk(user, row.store_id))
    return { ok: false, message: "票据不存在或无权限", code: 403 };
  if (row.status !== "approved") return { ok: false, message: "仅已批准票据可发放" };
  const now = nowIso();
  db.prepare(
    `UPDATE office_tickets
     SET status='issued', issued_by=?, issued_at=?, updated_at=? WHERE id=?`
  ).run(user.id, now, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.applicant_user_id,
    title: "票据已发放",
    body: row.title,
    kind: "office_ticket",
    ref_type: "office_ticket",
    ref_id: row.id,
  });
  addEvent(db, user, "ticket", row.id, "issued");
  writeAudit(db, user, "officeCollab.ticket.issue", "office_ticket", row.id);
  return { ok: true, data: { id: row.id, status: "issued" } };
}

export function returnTicket(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM office_tickets WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "票据不存在", code: 404 };
  if (row.status !== "issued") return { ok: false, message: "仅已发放票据可回收" };
  if (row.applicant_user_id !== user.id && !canManage(user))
    return { ok: false, message: "无回收权限", code: 403 };
  if (!scopeOk(user, row.store_id))
    return { ok: false, message: "无回收权限", code: 403 };
  const now = nowIso();
  db.prepare(
    `UPDATE office_tickets
     SET status='returned', returned_by=?, returned_at=?, updated_at=? WHERE id=?`
  ).run(user.id, now, now, row.id);
  addEvent(db, user, "ticket", row.id, "returned");
  writeAudit(db, user, "officeCollab.ticket.return", "office_ticket", row.id);
  return { ok: true, data: { id: row.id, status: "returned" } };
}

export function listSummaries(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT s.*, u.display_name AS user_name, h.title AS house_title, c.name AS customer_name
       FROM office_work_summaries s
       JOIN users u ON u.id=s.user_id
       LEFT JOIN houses h ON h.id=s.house_id
       LEFT JOIN customers c ON c.id=s.customer_id
       WHERE s.company_id=? ORDER BY s.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    if (user.role === "admin") return true;
    if (row.store_id !== user.store_id) return false;
    if (user.role === "store_manager") return true;
    return row.user_id === user.id;
  });
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function saveSummary(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const content = String(payload.content || "").trim();
  if (content.length < 4) return { ok: false, message: "总结内容至少 4 个字" };
  const periodStart = String(payload.period_start || "").trim();
  const periodEnd = String(payload.period_end || "").trim();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ||
    periodEnd < periodStart
  )
    return { ok: false, message: "总结周期无效" };
  if (payload.house_id) {
    const house = db
      .prepare(`SELECT id FROM houses WHERE id=? AND company_id=? AND store_id=?`)
      .get(payload.house_id, user.company_id, user.store_id);
    if (!house) return { ok: false, message: "关联房源无效" };
  }
  if (payload.customer_id) {
    const customer = db
      .prepare(`SELECT id FROM customers WHERE id=? AND company_id=? AND store_id=?`)
      .get(payload.customer_id, user.company_id, user.store_id);
    if (!customer) return { ok: false, message: "关联客源无效" };
  }
  const id = nextId("OWS");
  const now = nowIso();
  db.prepare(
    `INSERT INTO office_work_summaries(
       id, company_id, store_id, user_id, period_start, period_end, content,
       house_id, customer_id, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    user.id,
    periodStart,
    periodEnd,
    content,
    payload.house_id || null,
    payload.customer_id || null,
    now,
    now
  );
  addEvent(db, user, "summary", id, "created");
  writeAudit(db, user, "officeCollab.summary.create", "office_work_summary", id);
  return { ok: true, data: { id, status: "draft" } };
}

export function submitSummary(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM office_work_summaries WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.user_id !== user.id)
    return { ok: false, message: "总结不存在或无权限", code: 403 };
  if (row.status !== "draft") return { ok: false, message: "仅草稿可提交" };
  const now = nowIso();
  db.prepare(
    `UPDATE office_work_summaries
     SET status='submitted', submitted_at=?, updated_at=? WHERE id=?`
  ).run(now, now, row.id);
  addEvent(db, user, "summary", row.id, "submitted");
  writeAudit(db, user, "officeCollab.summary.submit", "office_work_summary", row.id);
  return { ok: true, data: { id: row.id, status: "submitted" } };
}

export function reviewSummary(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const comment = String(payload.comment || "").trim();
  if (comment.length < 2) return { ok: false, message: "评阅意见至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM office_work_summaries WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !scopeOk(user, row.store_id))
    return { ok: false, message: "总结不存在或无权限", code: 403 };
  if (row.status !== "submitted") return { ok: false, message: "仅已提交总结可评阅" };
  const now = nowIso();
  db.prepare(
    `UPDATE office_work_summaries
     SET status='reviewed', review_comment=?, reviewed_by=?, reviewed_at=?, updated_at=?
     WHERE id=?`
  ).run(comment, user.id, now, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.user_id,
    title: "工作总结已评阅",
    body: comment,
    kind: "office_work_summary",
    ref_type: "office_work_summary",
    ref_id: row.id,
  });
  addEvent(db, user, "summary", row.id, "reviewed", { comment });
  writeAudit(db, user, "officeCollab.summary.review", "office_work_summary", row.id);
  return { ok: true, data: { id: row.id, status: "reviewed" } };
}

export function listCirclePosts(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT p.*, u.display_name AS author_name
       FROM office_circle_posts p
       JOIN users u ON u.id=p.created_by
       WHERE p.company_id=? ORDER BY p.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    if (user.role === "admin") return true;
    if (row.store_id !== user.store_id) return false;
    if (canManage(user)) return true;
    return row.status === "published" || row.created_by === user.id;
  });
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function createCirclePost(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const content = String(payload.content || "").trim();
  if (content.length < 2) return { ok: false, message: "同事圈内容至少 2 个字" };
  const id = nextId("OCP");
  const now = nowIso();
  db.prepare(
    `INSERT INTO office_circle_posts(
       id, company_id, store_id, content, status, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'published', ?, ?, ?)`
  ).run(id, user.company_id, user.store_id, content, user.id, now, now);
  addEvent(db, user, "circle", id, "created");
  writeAudit(db, user, "officeCollab.circle.create", "office_circle_post", id);
  return { ok: true, data: { id, status: "published" } };
}

export function hideCirclePost(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "隐藏原因至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM office_circle_posts WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !scopeOk(user, row.store_id))
    return { ok: false, message: "动态不存在或无权限", code: 403 };
  if (row.status !== "published") return { ok: false, message: "动态已隐藏" };
  db.prepare(
    `UPDATE office_circle_posts
     SET status='hidden', hidden_reason=?, updated_at=? WHERE id=?`
  ).run(reason, nowIso(), row.id);
  addEvent(db, user, "circle", row.id, "hidden", { reason });
  writeAudit(db, user, "officeCollab.circle.hide", "office_circle_post", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id, status: "hidden" } };
}

export function listCalls(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT r.*, h.title AS house_title, c.name AS customer_name,
              u.display_name AS created_by_name
       FROM office_call_records r
       LEFT JOIN houses h ON h.id=r.matched_house_id
       LEFT JOIN customers c ON c.id=r.matched_customer_id
       JOIN users u ON u.id=r.created_by
       WHERE r.company_id=? ORDER BY r.called_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    if (user.role === "admin") return true;
    if (row.store_id !== user.store_id) return false;
    if (user.role === "store_manager") return true;
    return row.created_by === user.id;
  });
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      phone:
        user.role === "admin" ||
        user.role === "store_manager" ||
        row.created_by === user.id
          ? row.phone
          : maskPhone(row.phone),
    })),
  };
}

export function createCall(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const phone = String(payload.phone || "").trim();
  if (!/^1\d{10}$/.test(phone)) return { ok: false, message: "来电号码格式无效" };
  if (!["in", "out"].includes(payload.direction))
    return { ok: false, message: "通话方向无效" };
  const calledAt = String(payload.called_at || nowIso()).trim();
  if (!Date.parse(calledAt)) return { ok: false, message: "通话时间无效" };
  const customer = db
    .prepare(
      `SELECT id FROM customers WHERE company_id=? AND phone=? AND store_id=?
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(user.company_id, phone, user.store_id) as any;
  const house = db
    .prepare(
      `SELECT id FROM houses WHERE company_id=? AND owner_phone=? AND store_id=?
       AND status NOT IN ('closed','withdrawn')
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(user.company_id, phone, user.store_id) as any;
  const id = nextId("OCR");
  const now = nowIso();
  db.prepare(
    `INSERT INTO office_call_records(
       id, company_id, store_id, phone, direction, matched_house_id, matched_customer_id,
       note, called_at, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    phone,
    payload.direction,
    house?.id || null,
    customer?.id || null,
    String(payload.note || "").trim() || null,
    calledAt,
    user.id,
    now,
    now
  );
  addEvent(db, user, "call", id, "created", {
    matched_house_id: house?.id || null,
    matched_customer_id: customer?.id || null,
  });
  writeAudit(db, user, "officeCollab.call.create", "office_call_record", id);
  return {
    ok: true,
    data: {
      id,
      matched_house_id: house?.id || null,
      matched_customer_id: customer?.id || null,
    },
  };
}
