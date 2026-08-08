import type { Db } from "../db/database";
import { customerVisibleTo, maskPhone } from "../auth/policy";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function refreshExpired(db: Db, companyId: string): number {
  const now = nowIso();
  return db
    .prepare(
      `UPDATE newhome_registrations SET status='expired', updated_at=?
       WHERE company_id=? AND status='registered' AND protect_until<?`
    )
    .run(now, companyId, now).changes;
}

export function listProjects(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(`SELECT * FROM newhome_projects WHERE company_id=? ORDER BY updated_at DESC`)
    .all(user.company_id) as any[];
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.keyword) {
    const keyword = String(payload.keyword);
    rows = rows.filter(
      (row) => row.name.includes(keyword) || row.address.includes(keyword)
    );
  }
  return { ok: true, data: rows };
}

export function upsertProject(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  const name = String(payload.name || "").trim();
  const address = String(payload.address || "").trim();
  const protectionDays = Number(payload.protection_days);
  if (!name || !address)
    return { ok: false, message: "项目名称和地址必填" };
  if (!Number.isInteger(protectionDays) || protectionDays < 1 || protectionDays > 365)
    return { ok: false, message: "保护期须为 1～365 天" };
  if (!["residential", "shop", "office", "apartment", "other"].includes(payload.property_type))
    return { ok: false, message: "项目物业类型无效" };
  const now = nowIso();
  if (payload.id) {
    const project = db
      .prepare(`SELECT * FROM newhome_projects WHERE id=? AND company_id=?`)
      .get(payload.id, user.company_id) as any;
    if (
      !project ||
      (user.role === "store_manager" && project.store_id !== user.store_id)
    )
      return { ok: false, message: "项目不存在或无权限", code: 403 };
    db.prepare(
      `UPDATE newhome_projects SET name=?, address=?, property_type=?,
       protection_days=?, contact_name=?, contact_phone=?, commission_rule=?,
       status=?, updated_at=? WHERE id=?`
    ).run(
      name,
      address,
      payload.property_type,
      protectionDays,
      payload.contact_name || null,
      payload.contact_phone || null,
      payload.commission_rule || null,
      payload.status || project.status,
      now,
      project.id
    );
    writeAudit(db, user, "newhome.project.update", "newhome_project", project.id);
    return { ok: true, data: { id: project.id } };
  }
  const id = nextId("NHP");
  try {
    db.prepare(
      `INSERT INTO newhome_projects(
         id, company_id, store_id, name, address, property_type, protection_days,
         contact_name, contact_phone, commission_rule, status,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      user.store_id,
      name,
      address,
      payload.property_type,
      protectionDays,
      payload.contact_name || null,
      payload.contact_phone || null,
      payload.commission_rule || null,
      user.id,
      now,
      now
    );
  } catch {
    return { ok: false, message: "同名新房项目已存在", code: 409 };
  }
  writeAudit(db, user, "newhome.project.create", "newhome_project", id);
  return { ok: true, data: { id } };
}

function registrationVisible(user: SessionUser, row: any): boolean {
  if (user.role === "admin") return true;
  if (row.store_id !== user.store_id) return false;
  if (user.role === "store_manager") return true;
  return user.role === "agent" && row.agent_id === user.id;
}

export function listRegistrations(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  refreshExpired(db, user.company_id);
  let rows = db
    .prepare(
      `SELECT r.*, p.name AS project_name, p.protection_days,
       c.name AS customer_name, c.phone AS customer_phone,
       u.display_name AS agent_name
       FROM newhome_registrations r
       JOIN newhome_projects p ON p.id=r.project_id
       JOIN customers c ON c.id=r.customer_id
       JOIN users u ON u.id=r.agent_id
       WHERE r.company_id=? ORDER BY r.registered_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => registrationVisible(user, row));
  if (payload.project_id) rows = rows.filter((row) => row.project_id === payload.project_id);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      customer_phone:
        user.role === "admin" ||
        user.role === "store_manager" ||
        row.agent_id === user.id
          ? row.customer_phone
          : maskPhone(row.customer_phone),
    })),
  };
}

export function registerCustomer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const project = db
    .prepare(`SELECT * FROM newhome_projects WHERE id=? AND company_id=?`)
    .get(payload.project_id, user.company_id) as any;
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id=? AND company_id=?`)
    .get(payload.customer_id, user.company_id) as any;
  if (!project || project.status !== "active")
    return { ok: false, message: "新房项目不存在或未启用" };
  if (!customer || !customerVisibleTo(user, customer))
    return { ok: false, message: "客户不存在或无权限", code: 403 };
  if (
    user.role === "store_manager" &&
    customer.store_id !== user.store_id
  )
    return { ok: false, message: "只能报备本店客户", code: 403 };
  refreshExpired(db, user.company_id);
  const duplicate = db
    .prepare(
      `SELECT * FROM newhome_registrations
       WHERE company_id=? AND project_id=? AND customer_id=?
       AND status IN ('registered','arrived') AND protect_until>=?
       ORDER BY registered_at DESC LIMIT 1`
    )
    .get(user.company_id, project.id, customer.id, nowIso()) as any;
  if (duplicate)
    return {
      ok: false,
      message: `客户仍在保护期内，保护至 ${duplicate.protect_until.slice(0, 10)}`,
      code: 409,
    };
  const registeredAt = nowIso();
  const protectUntil = new Date(
    Date.now() + Number(project.protection_days) * 86400000
  ).toISOString();
  const agentId =
    user.role === "agent" ? user.id : payload.agent_id || customer.agent_id;
  const assignedAgent = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=? AND status='active'`)
    .get(agentId, user.company_id) as any;
  if (
    !assignedAgent ||
    assignedAgent.role !== "agent" ||
    assignedAgent.store_id !== customer.store_id
  )
    return { ok: false, message: "报备经纪人须为客户同店在职经纪人" };
  const id = nextId("NHR");
  db.prepare(
    `INSERT INTO newhome_registrations(
       id, company_id, store_id, project_id, customer_id, agent_id,
       status, source, contact_name, registered_at, protect_until,
       created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'registered', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    customer.store_id,
    project.id,
    customer.id,
    agentId,
    payload.source || customer.source || null,
    payload.contact_name || project.contact_name || null,
    registeredAt,
    protectUntil,
    user.id,
    registeredAt,
    registeredAt
  );
  writeAudit(db, user, "newhome.registration.create", "newhome_registration", id, {
    project_id: project.id,
    customer_id: customer.id,
    protect_until: protectUntil,
  });
  return { ok: true, data: { id, protect_until: protectUntil } };
}

export function confirmArrival(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(
      `SELECT r.*, p.name AS project_name FROM newhome_registrations r
       JOIN newhome_projects p ON p.id=r.project_id
       WHERE r.id=? AND r.company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (!row || !registrationVisible(user, row))
    return { ok: false, message: "报备不存在或无权限", code: 403 };
  if (row.status !== "registered") return { ok: false, message: "当前报备不可确认到场" };
  if (row.protect_until < nowIso()) {
    refreshExpired(db, user.company_id);
    return { ok: false, message: "报备保护期已过期" };
  }
  const note = String(payload.arrival_note || "").trim();
  if (note.length < 2) return { ok: false, message: "到场说明至少 2 个字" };
  const now = nowIso();
  db.prepare(
    `UPDATE newhome_registrations SET status='arrived', arrived_at=?,
     arrival_note=?, updated_at=? WHERE id=?`
  ).run(now, note, now, row.id);
  writeAudit(db, user, "newhome.registration.arrival", "newhome_registration", row.id);
  return { ok: true, data: { id: row.id, arrived_at: now } };
}

export function invalidateRegistration(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "作废原因必填" };
  const row = db
    .prepare(`SELECT * FROM newhome_registrations WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !registrationVisible(user, row))
    return { ok: false, message: "报备不存在或无权限", code: 403 };
  if (!["registered", "arrived"].includes(row.status))
    return { ok: false, message: "当前报备不可作废" };
  const now = nowIso();
  db.prepare(
    `UPDATE newhome_registrations SET status='invalid', invalidated_at=?,
     invalid_reason=?, updated_at=? WHERE id=?`
  ).run(now, reason, now, row.id);
  if (row.agent_id !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.agent_id,
      title: "新房报备已作废",
      body: reason,
      kind: "newhome_registration",
      ref_type: "newhome_registration",
      ref_id: row.id,
    });
  }
  writeAudit(db, user, "newhome.registration.invalidate", "newhome_registration", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id } };
}

export function expireRegistrations(db: Db, user: SessionUser): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  const expired = refreshExpired(db, user.company_id);
  writeAudit(db, user, "newhome.registration.expire", "newhome_registration", undefined, {
    expired,
  });
  return { ok: true, data: { expired } };
}
