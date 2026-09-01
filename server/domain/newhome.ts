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
  const linkedSale = db
    .prepare(
      `SELECT id FROM newhome_sales_reports
       WHERE registration_id=? AND status IN ('submitted','approved','settled')`
    )
    .get(row.id) as any;
  if (linkedSale) return { ok: false, message: "已关联有效销售报告，不可作废" };
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

function canManagePartners(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "store_manager";
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
    `INSERT INTO newhome_events(
      id, company_id, entity_type, entity_id, event_type, details, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("NHE"),
    user.company_id,
    entityType,
    entityId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function distributionVisible(user: SessionUser, row: any): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  if (!row.store_id || row.store_id === user.store_id) return true;
  return false;
}

function salesVisible(user: SessionUser, row: any): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  if (row.store_id !== user.store_id) return false;
  if (user.role === "store_manager") return true;
  return row.agent_id === user.id || row.created_by === user.id;
}

function canSeeSettlement(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "finance";
}

function presentSalesReport(user: SessionUser, row: any) {
  const base = {
    ...row,
    customer_phone:
      user.role === "admin" ||
      user.role === "store_manager" ||
      row.agent_id === user.id
        ? row.customer_phone
        : maskPhone(row.customer_phone),
  };
  if (canSeeSettlement(user)) return base;
  return {
    ...base,
    settlement_amount: null,
    settlement_note: null,
  };
}

export function newhomeOptions(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance") {
    return {
      ok: true,
      data: { projects: [], registrations: [], distribution_companies: [] },
    };
  }
  refreshExpired(db, user.company_id);
  let projects = db
    .prepare(
      `SELECT id, name, status FROM newhome_projects
       WHERE company_id=? AND status='active' ORDER BY name`
    )
    .all(user.company_id) as any[];
  let registrations = db
    .prepare(
      `SELECT r.id, r.project_id, r.customer_id, r.agent_id, r.store_id, r.status,
              p.name AS project_name, c.name AS customer_name
       FROM newhome_registrations r
       JOIN newhome_projects p ON p.id=r.project_id
       JOIN customers c ON c.id=r.customer_id
       WHERE r.company_id=? AND r.status='arrived'
       ORDER BY r.arrived_at DESC`
    )
    .all(user.company_id) as any[];
  let companies = db
    .prepare(
      `SELECT id, store_id, name, status FROM newhome_distribution_companies
       WHERE company_id=? AND status='active' ORDER BY name`
    )
    .all(user.company_id) as any[];
  registrations = registrations.filter((row) => registrationVisible(user, row));
  companies = companies.filter((row) => distributionVisible(user, row));
  return {
    ok: true,
    data: {
      projects,
      registrations,
      distribution_companies: companies,
    },
  };
}

export function listDistributionCompanies(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  let rows = db
    .prepare(
      `SELECT d.*, u.display_name AS created_by_name
       FROM newhome_distribution_companies d
       JOIN users u ON u.id=d.created_by
       WHERE d.company_id=?
       ORDER BY d.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => distributionVisible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.keyword) {
    const keyword = String(payload.keyword).trim();
    rows = rows.filter(
      (row) =>
        row.name.includes(keyword) ||
        (row.contact_name || "").includes(keyword) ||
        (row.address || "").includes(keyword)
    );
  }
  return { ok: true, data: rows };
}

export function upsertDistributionCompany(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  if (!canManagePartners(user))
    return { ok: false, message: "无权限", code: 403 };
  const name = String(payload.name || "").trim();
  if (!name) return { ok: false, message: "分销公司名称必填" };
  const contactPhone = String(payload.contact_phone || "").trim();
  if (contactPhone && !/^1\d{10}$/.test(contactPhone))
    return { ok: false, message: "联系电话格式无效" };
  const now = nowIso();
  const storeId =
    user.role === "admin" ? payload.store_id || user.store_id || null : user.store_id;
  if (payload.id) {
    const row = db
      .prepare(
        `SELECT * FROM newhome_distribution_companies WHERE id=? AND company_id=?`
      )
      .get(payload.id, user.company_id) as any;
    if (!row || !distributionVisible(user, row))
      return { ok: false, message: "分销公司不存在或无权限", code: 403 };
    if (user.role === "store_manager" && row.store_id !== user.store_id)
      return { ok: false, message: "只能维护本店分销公司", code: 403 };
    try {
      db.prepare(
        `UPDATE newhome_distribution_companies
         SET name=?, contact_name=?, contact_phone=?, address=?, remark=?,
             store_id=?, updated_at=?
         WHERE id=?`
      ).run(
        name,
        String(payload.contact_name || "").trim() || null,
        contactPhone || null,
        String(payload.address || "").trim() || null,
        String(payload.remark || "").trim() || null,
        storeId,
        now,
        row.id
      );
    } catch {
      return { ok: false, message: "同名分销公司已存在", code: 409 };
    }
    addEvent(db, user, "distribution_company", row.id, "updated", { name });
    writeAudit(db, user, "newhome.distribution.update", "newhome_distribution_company", row.id);
    return { ok: true, data: { id: row.id } };
  }
  const id = nextId("NDC");
  try {
    db.prepare(
      `INSERT INTO newhome_distribution_companies(
         id, company_id, store_id, name, contact_name, contact_phone, address,
         remark, status, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      storeId,
      name,
      String(payload.contact_name || "").trim() || null,
      contactPhone || null,
      String(payload.address || "").trim() || null,
      String(payload.remark || "").trim() || null,
      user.id,
      now,
      now
    );
  } catch {
    return { ok: false, message: "同名分销公司已存在", code: 409 };
  }
  addEvent(db, user, "distribution_company", id, "created", { name });
  writeAudit(db, user, "newhome.distribution.create", "newhome_distribution_company", id);
  return { ok: true, data: { id } };
}

export function setDistributionStatus(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  if (!canManagePartners(user))
    return { ok: false, message: "无权限", code: 403 };
  if (!["active", "inactive"].includes(payload.status))
    return { ok: false, message: "分销公司状态无效" };
  const row = db
    .prepare(
      `SELECT * FROM newhome_distribution_companies WHERE id=? AND company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (!row || !distributionVisible(user, row))
    return { ok: false, message: "分销公司不存在或无权限", code: 403 };
  if (user.role === "store_manager" && row.store_id !== user.store_id)
    return { ok: false, message: "只能维护本店分销公司", code: 403 };
  if (row.status === payload.status)
    return { ok: true, data: { id: row.id, status: row.status } };
  const now = nowIso();
  db.prepare(
    `UPDATE newhome_distribution_companies SET status=?, updated_at=? WHERE id=?`
  ).run(payload.status, now, row.id);
  addEvent(db, user, "distribution_company", row.id, "status", {
    from: row.status,
    to: payload.status,
  });
  writeAudit(
    db,
    user,
    "newhome.distribution.status",
    "newhome_distribution_company",
    row.id,
    { status: payload.status }
  );
  const label = payload.status === "active" ? "已启用" : "已停用";
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
      title: `分销公司${label}`,
      body: row.name,
      kind: "distribution_status",
      ref_type: "newhome_distribution_company",
      ref_id: row.id,
    });
  }
  return { ok: true, data: { id: row.id, status: payload.status } };
}

export function exportDistributionCompanies(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  if (!canManagePartners(user))
    return { ok: false, message: "无权限", code: 403 };
  const listed = listDistributionCompanies(db, user, payload);
  if (!listed.ok) return listed;
  const rows = listed.data as any[];
  const header = ["名称", "状态", "联系人", "电话", "地址", "备注", "更新时间"];
  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.name,
        row.status === "active" ? "启用" : "停用",
        row.contact_name || "",
        row.contact_phone || "",
        row.address || "",
        row.remark || "",
        row.updated_at,
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    ),
  ];
  const csv = `\uFEFF${lines.join("\n")}`;
  writeAudit(db, user, "newhome.distribution.export", "newhome_distribution_company", undefined, {
    count: rows.length,
  });
  return { ok: true, data: { csv, count: rows.length } };
}

export function listSalesReports(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  refreshExpired(db, user.company_id);
  let rows = db
    .prepare(
      `SELECT s.*, p.name AS project_name, c.name AS customer_name, c.phone AS customer_phone,
              u.display_name AS agent_name, d.name AS distribution_company_name,
              (SELECT COUNT(*) FROM file_attachments a
               WHERE a.parent_type='newhome_sales_report' AND a.parent_id=s.id) AS attachment_count
       FROM newhome_sales_reports s
       JOIN newhome_projects p ON p.id=s.project_id
       JOIN customers c ON c.id=s.customer_id
       JOIN users u ON u.id=s.agent_id
       LEFT JOIN newhome_distribution_companies d ON d.id=s.distribution_company_id
       WHERE s.company_id=?
       ORDER BY s.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => salesVisible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.project_id)
    rows = rows.filter((row) => row.project_id === payload.project_id);
  return { ok: true, data: rows.map((row) => presentSalesReport(user, row)) };
}

export function createSalesReport(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const registration = db
    .prepare(
      `SELECT r.*, p.name AS project_name, c.name AS customer_name
       FROM newhome_registrations r
       JOIN newhome_projects p ON p.id=r.project_id
       JOIN customers c ON c.id=r.customer_id
       WHERE r.id=? AND r.company_id=?`
    )
    .get(payload.registration_id, user.company_id) as any;
  if (!registration || !registrationVisible(user, registration))
    return { ok: false, message: "报备不存在或无权限", code: 403 };
  if (registration.status !== "arrived")
    return { ok: false, message: "仅已到场报备可创建销售报告" };
  const existing = db
    .prepare(
      `SELECT id, status FROM newhome_sales_reports
       WHERE registration_id=? AND status != 'cancelled'`
    )
    .get(registration.id) as any;
  if (existing)
    return { ok: false, message: "该报备已有销售报告", code: 409 };
  const unitNo = String(payload.unit_no || "").trim();
  const contractPrice = Number(payload.contract_price);
  const signedAt = String(payload.signed_at || "").trim();
  if (!unitNo) return { ok: false, message: "房号必填" };
  if (!Number.isFinite(contractPrice) || contractPrice <= 0)
    return { ok: false, message: "网签总价须大于 0" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signedAt))
    return { ok: false, message: "签约日期格式应为 YYYY-MM-DD" };
  let distributionCompanyId = payload.distribution_company_id || null;
  if (distributionCompanyId) {
    const partner = db
      .prepare(
        `SELECT * FROM newhome_distribution_companies WHERE id=? AND company_id=?`
      )
      .get(distributionCompanyId, user.company_id) as any;
    if (!partner || partner.status !== "active" || !distributionVisible(user, partner))
      return { ok: false, message: "分销公司不可用" };
  }
  const areaSize =
    payload.area_size === undefined || payload.area_size === null || payload.area_size === ""
      ? null
      : Number(payload.area_size);
  if (areaSize !== null && (!Number.isFinite(areaSize) || areaSize <= 0))
    return { ok: false, message: "面积须大于 0" };
  const now = nowIso();
  const id = nextId("NSR");
  db.prepare(
    `INSERT INTO newhome_sales_reports(
       id, company_id, store_id, project_id, registration_id, customer_id, agent_id,
       distribution_company_id, building, unit_no, area_size, contract_price, signed_at,
       status, remark, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    registration.store_id,
    registration.project_id,
    registration.id,
    registration.customer_id,
    registration.agent_id,
    distributionCompanyId,
    String(payload.building || "").trim() || null,
    unitNo,
    areaSize,
    contractPrice,
    signedAt,
    String(payload.remark || "").trim() || null,
    user.id,
    now,
    now
  );
  addEvent(db, user, "sales_report", id, "created", {
    registration_id: registration.id,
    contract_price: contractPrice,
  });
  writeAudit(db, user, "newhome.sales.create", "newhome_sales_report", id);
  return { ok: true, data: { id } };
}

export function updateSalesReport(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM newhome_sales_reports WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !salesVisible(user, row))
    return { ok: false, message: "销售报告不存在或无权限", code: 403 };
  if (!["draft", "rejected"].includes(row.status))
    return { ok: false, message: "当前状态不可修改" };
  if (user.role === "agent" && row.agent_id !== user.id && row.created_by !== user.id)
    return { ok: false, message: "只能修改本人销售报告", code: 403 };
  const unitNo = String(payload.unit_no || "").trim();
  const contractPrice = Number(payload.contract_price);
  const signedAt = String(payload.signed_at || "").trim();
  if (!unitNo) return { ok: false, message: "房号必填" };
  if (!Number.isFinite(contractPrice) || contractPrice <= 0)
    return { ok: false, message: "网签总价须大于 0" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signedAt))
    return { ok: false, message: "签约日期格式应为 YYYY-MM-DD" };
  let distributionCompanyId = payload.distribution_company_id || null;
  if (distributionCompanyId) {
    const partner = db
      .prepare(
        `SELECT * FROM newhome_distribution_companies WHERE id=? AND company_id=?`
      )
      .get(distributionCompanyId, user.company_id) as any;
    if (!partner || partner.status !== "active" || !distributionVisible(user, partner))
      return { ok: false, message: "分销公司不可用" };
  }
  const areaSize =
    payload.area_size === undefined || payload.area_size === null || payload.area_size === ""
      ? null
      : Number(payload.area_size);
  if (areaSize !== null && (!Number.isFinite(areaSize) || areaSize <= 0))
    return { ok: false, message: "面积须大于 0" };
  const now = nowIso();
  db.prepare(
    `UPDATE newhome_sales_reports
     SET distribution_company_id=?, building=?, unit_no=?, area_size=?,
         contract_price=?, signed_at=?, remark=?, status='draft',
         reject_reason=NULL, updated_at=?
     WHERE id=?`
  ).run(
    distributionCompanyId,
    String(payload.building || "").trim() || null,
    unitNo,
    areaSize,
    contractPrice,
    signedAt,
    String(payload.remark || "").trim() || null,
    now,
    row.id
  );
  addEvent(db, user, "sales_report", row.id, "updated", { contract_price: contractPrice });
  writeAudit(db, user, "newhome.sales.update", "newhome_sales_report", row.id);
  return { ok: true, data: { id: row.id } };
}

export function submitSalesReport(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM newhome_sales_reports WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !salesVisible(user, row))
    return { ok: false, message: "销售报告不存在或无权限", code: 403 };
  if (!["draft", "rejected"].includes(row.status))
    return { ok: false, message: "当前状态不可提交" };
  if (user.role === "agent" && row.agent_id !== user.id && row.created_by !== user.id)
    return { ok: false, message: "只能提交本人销售报告", code: 403 };
  const materials = db
    .prepare(
      `SELECT id FROM file_attachments
       WHERE parent_type='newhome_sales_report' AND parent_id=? AND category='contract_scan'`
    )
    .all(row.id) as any[];
  if (!materials.length)
    return { ok: false, message: "提交前须上传网签合同扫描件" };
  const now = nowIso();
  db.prepare(
    `UPDATE newhome_sales_reports
     SET status='submitted', reject_reason=NULL, updated_at=? WHERE id=?`
  ).run(now, row.id);
  const managers = db
    .prepare(
      `SELECT id FROM users
       WHERE company_id=? AND status='active'
         AND (role='admin' OR (role='store_manager' AND store_id=?))`
    )
    .all(user.company_id, row.store_id) as any[];
  for (const manager of managers) {
    if (manager.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: manager.id,
      title: "新房销售报告待审批",
      body: `房号 ${row.unit_no}，网签总价 ${row.contract_price}`,
      kind: "newhome_sales_report",
      ref_type: "newhome_sales_report",
      ref_id: row.id,
    });
  }
  addEvent(db, user, "sales_report", row.id, "submitted");
  writeAudit(db, user, "newhome.sales.submit", "newhome_sales_report", row.id);
  return { ok: true, data: { id: row.id, status: "submitted" } };
}

export function approveSalesReport(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM newhome_sales_reports WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !salesVisible(user, row))
    return { ok: false, message: "销售报告不存在或无权限", code: 403 };
  if (row.status !== "submitted")
    return { ok: false, message: "仅待审批报告可批准" };
  if (user.role === "store_manager" && row.store_id !== user.store_id)
    return { ok: false, message: "只能审批本店销售报告", code: 403 };
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE newhome_sales_reports SET status='approved', updated_at=? WHERE id=?`
    ).run(now, row.id);
    db.prepare(
      `UPDATE newhome_registrations SET status='sold', updated_at=? WHERE id=? AND status='arrived'`
    ).run(now, row.registration_id);
  });
  tx();
  if (row.agent_id !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.agent_id,
      title: "新房销售报告已审批",
      body: `房号 ${row.unit_no} 销售报告已通过`,
      kind: "newhome_sales_report",
      ref_type: "newhome_sales_report",
      ref_id: row.id,
    });
  }
  addEvent(db, user, "sales_report", row.id, "approved");
  writeAudit(db, user, "newhome.sales.approve", "newhome_sales_report", row.id);
  return { ok: true, data: { id: row.id, status: "approved" } };
}

export function rejectSalesReport(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "驳回原因至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM newhome_sales_reports WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !salesVisible(user, row))
    return { ok: false, message: "销售报告不存在或无权限", code: 403 };
  if (row.status !== "submitted")
    return { ok: false, message: "仅待审批报告可驳回" };
  if (user.role === "store_manager" && row.store_id !== user.store_id)
    return { ok: false, message: "只能驳回本店销售报告", code: 403 };
  const now = nowIso();
  db.prepare(
    `UPDATE newhome_sales_reports
     SET status='rejected', reject_reason=?, updated_at=? WHERE id=?`
  ).run(reason, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.agent_id,
    title: "新房销售报告已驳回",
    body: reason,
    kind: "newhome_sales_report",
    ref_type: "newhome_sales_report",
    ref_id: row.id,
  });
  addEvent(db, user, "sales_report", row.id, "rejected", { reason });
  writeAudit(db, user, "newhome.sales.reject", "newhome_sales_report", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id, status: "rejected" } };
}

export function settleSalesReport(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "finance"))
    return { ok: false, message: "无权限", code: 403 };
  const amount = Number(payload.settlement_amount);
  if (!Number.isFinite(amount) || amount < 0)
    return { ok: false, message: "结算金额无效" };
  const note = String(payload.settlement_note || "").trim();
  if (note.length < 2) return { ok: false, message: "结算说明至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM newhome_sales_reports WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "销售报告不存在或无权限", code: 403 };
  if (row.status !== "approved")
    return { ok: false, message: "仅已审批报告可登记结算" };
  const now = nowIso();
  db.prepare(
    `UPDATE newhome_sales_reports
     SET status='settled', settlement_amount=?, settlement_note=?, settled_at=?, updated_at=?
     WHERE id=?`
  ).run(amount, note, now, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.agent_id,
    title: "新房销售报告已结算",
    body: `房号 ${row.unit_no} 已登记结算`,
    kind: "newhome_sales_report",
    ref_type: "newhome_sales_report",
    ref_id: row.id,
  });
  addEvent(db, user, "sales_report", row.id, "settled", {
    settlement_amount: amount,
  });
  writeAudit(db, user, "newhome.sales.settle", "newhome_sales_report", row.id, {
    settlement_amount: amount,
  });
  return { ok: true, data: { id: row.id, status: "settled" } };
}

export function cancelSalesReport(db: Db, user: SessionUser, payload: any): ApiResult {
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "取消原因至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM newhome_sales_reports WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !salesVisible(user, row))
    return { ok: false, message: "销售报告不存在或无权限", code: 403 };
  if (!["draft", "rejected", "submitted"].includes(row.status))
    return { ok: false, message: "当前状态不可取消" };
  if (
    user.role === "agent" &&
    row.agent_id !== user.id &&
    row.created_by !== user.id
  )
    return { ok: false, message: "只能取消本人销售报告", code: 403 };
  if (user.role === "finance")
    return { ok: false, message: "无权限", code: 403 };
  if (row.status === "submitted" && user.role === "agent")
    return { ok: false, message: "待审批报告请联系店长取消", code: 403 };
  const now = nowIso();
  db.prepare(
    `UPDATE newhome_sales_reports
     SET status='cancelled', reject_reason=?, updated_at=? WHERE id=?`
  ).run(reason, now, row.id);
  addEvent(db, user, "sales_report", row.id, "cancelled", { reason });
  writeAudit(db, user, "newhome.sales.cancel", "newhome_sales_report", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id, status: "cancelled" } };
}
