import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso, todayDate } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const ASSIGNABLE_ROLES = new Set(["store_manager", "agent", "finance"]);

function canManage(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "store_manager";
}

function transferVisible(user: SessionUser, row: any): boolean {
  return (
    user.role === "admin" ||
    (user.role === "store_manager" &&
      (row.from_store_id === user.store_id || row.to_store_id === user.store_id))
  );
}

function assets(db: Db, companyId: string, userId: string) {
  const houses = db
    .prepare(
      `SELECT id, title FROM houses WHERE company_id=? AND agent_id=?
       AND status NOT IN ('closed','withdrawn')`
    )
    .all(companyId, userId) as any[];
  const customers = db
    .prepare(
      `SELECT id, name FROM customers WHERE company_id=? AND agent_id=?
       AND status NOT IN ('closed','invalid') AND merged_into_id IS NULL`
    )
    .all(companyId, userId) as any[];
  const keys = db
    .prepare(
      `SELECT id, key_no FROM house_keys WHERE company_id=?
       AND (borrower_user_id=? OR keeper_user_id=?)`
    )
    .all(companyId, userId, userId) as any[];
  const roles = db
    .prepare(
      `SELECT id, house_id, role_type FROM house_role_holders
       WHERE company_id=? AND user_id=?`
    )
    .all(companyId, userId) as any[];
  return { houses, customers, keys, roles };
}

export function workforceOptions(db: Db, user: SessionUser): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  let users = db
    .prepare(
      `SELECT u.id, u.store_id, u.display_name, u.role, u.status,
       a.job_grade_id, g.name AS grade_name
       FROM users u
       LEFT JOIN employee_job_assignments a ON a.user_id=u.id
       LEFT JOIN job_grades g ON g.id=a.job_grade_id
       WHERE u.company_id=? ORDER BY u.display_name`
    )
    .all(user.company_id) as any[];
  if (user.role === "store_manager")
    users = users.filter((employee) => employee.store_id === user.store_id);
  const stores = db
    .prepare(`SELECT id, name FROM stores WHERE company_id=? AND status='active' ORDER BY name`)
    .all(user.company_id);
  const grades = db
    .prepare(
      `SELECT * FROM job_grades WHERE company_id=? AND status='active'
       ORDER BY rank_level, name`
    )
    .all(user.company_id);
  return { ok: true, data: { users, stores, grades } };
}

export function listJobGrades(db: Db, user: SessionUser): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const rows = db
    .prepare(
      `SELECT g.*, COUNT(a.user_id) AS employee_count
       FROM job_grades g LEFT JOIN employee_job_assignments a ON a.job_grade_id=g.id
       WHERE g.company_id=? GROUP BY g.id ORDER BY g.rank_level, g.name`
    )
    .all(user.company_id);
  return { ok: true, data: rows };
}

export function saveJobGrade(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const code = String(payload.code || "").trim().toUpperCase();
  const name = String(payload.name || "").trim();
  const rank = Number(payload.rank_level);
  if (!code || !name || !Number.isInteger(rank) || rank < 1 || rank > 99)
    return { ok: false, message: "职级代码、名称和 1-99 级序必填" };
  if (payload.applicable_role && !ASSIGNABLE_ROLES.has(payload.applicable_role))
    return { ok: false, message: "适用角色无效" };
  const now = nowIso();
  if (payload.id) {
    const existing = db
      .prepare(`SELECT * FROM job_grades WHERE id=? AND company_id=?`)
      .get(payload.id, user.company_id) as any;
    if (!existing) return { ok: false, message: "职级不存在" };
    try {
      db.prepare(
        `UPDATE job_grades SET code=?, name=?, rank_level=?, applicable_role=?,
         description=?, status=?, updated_at=? WHERE id=?`
      ).run(
        code,
        name,
        rank,
        payload.applicable_role || null,
        String(payload.description || "").trim() || null,
        payload.status === "inactive" ? "inactive" : "active",
        now,
        existing.id
      );
    } catch {
      return { ok: false, message: "职级代码或名称已存在", code: 409 };
    }
    writeAudit(db, user, "job_grade.update", "job_grade", existing.id);
    return { ok: true, data: { id: existing.id } };
  }
  const id = nextId("JG");
  try {
    db.prepare(
      `INSERT INTO job_grades(
        id, company_id, code, name, rank_level, applicable_role,
        description, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      code,
      name,
      rank,
      payload.applicable_role || null,
      String(payload.description || "").trim() || null,
      user.id,
      now,
      now
    );
  } catch {
    return { ok: false, message: "职级代码或名称已存在", code: 409 };
  }
  writeAudit(db, user, "job_grade.create", "job_grade", id);
  return { ok: true, data: { id } };
}

export function assignJobGrade(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "定级原因必填" };
  const employee = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.user_id, user.company_id) as any;
  const grade = db
    .prepare(`SELECT * FROM job_grades WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.job_grade_id, user.company_id) as any;
  if (!employee || employee.role === "admin") return { ok: false, message: "员工无效" };
  if (!grade) return { ok: false, message: "职级无效" };
  if (grade.applicable_role && grade.applicable_role !== employee.role)
    return { ok: false, message: "职级与员工角色不匹配" };
  const current = db
    .prepare(`SELECT * FROM employee_job_assignments WHERE user_id=?`)
    .get(employee.id) as any;
  const now = nowIso();
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO employee_job_assignments(
        user_id, company_id, job_grade_id, assigned_by, assigned_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET job_grade_id=excluded.job_grade_id,
      assigned_by=excluded.assigned_by, assigned_at=excluded.assigned_at,
      updated_at=excluded.updated_at`
    ).run(employee.id, user.company_id, grade.id, user.id, now, now);
    db.prepare(
      `INSERT INTO employee_grade_history(
        id, company_id, user_id, from_grade_id, to_grade_id,
        reason, changed_by, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nextId("JGH"),
      user.company_id,
      employee.id,
      current?.job_grade_id || null,
      grade.id,
      reason,
      user.id,
      now
    );
  });
  transaction();
  writeAudit(db, user, "job_grade.assign", "user", employee.id, {
    from_grade_id: current?.job_grade_id || null,
    to_grade_id: grade.id,
    reason,
  });
  return { ok: true, data: { user_id: employee.id, job_grade_id: grade.id } };
}

export function previewTransfer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const employee = db
    .prepare(
      `SELECT id, store_id, display_name, role, status FROM users
       WHERE id=? AND company_id=?`
    )
    .get(payload.user_id, user.company_id) as any;
  if (
    !employee ||
    employee.status !== "active" ||
    employee.role === "admin" ||
    (user.role === "store_manager" &&
      (employee.store_id !== user.store_id || employee.id === user.id))
  )
    return { ok: false, message: "员工不存在或无权限", code: 403 };
  return { ok: true, data: { employee, ...assets(db, user.company_id, employee.id) } };
}

export function listTransfers(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT t.*, u.display_name AS employee_name, from_store.name AS from_store_name,
       to_store.name AS to_store_name, handover.display_name AS handover_name,
       creator.display_name AS creator_name
       FROM employee_transfer_requests t
       JOIN users u ON u.id=t.user_id
       JOIN stores from_store ON from_store.id=t.from_store_id
       JOIN stores to_store ON to_store.id=t.to_store_id
       JOIN users handover ON handover.id=t.handover_user_id
       JOIN users creator ON creator.id=t.created_by
       WHERE t.company_id=? ORDER BY t.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => transferVisible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function createTransfer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "调动原因必填" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.effective_date || "")))
    return { ok: false, message: "生效日期无效" };
  const employee = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.user_id, user.company_id) as any;
  const targetStore = db
    .prepare(`SELECT * FROM stores WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.to_store_id, user.company_id) as any;
  const handover = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.handover_user_id, user.company_id) as any;
  if (
    !employee ||
    employee.role === "admin" ||
    (user.role === "store_manager" &&
      (employee.store_id !== user.store_id || employee.id === user.id))
  )
    return { ok: false, message: "调动员工无效或无权限", code: 403 };
  if (!targetStore || targetStore.id === employee.store_id)
    return { ok: false, message: "目标门店须与原门店不同" };
  const toRole = payload.to_role || employee.role;
  if (!ASSIGNABLE_ROLES.has(toRole)) return { ok: false, message: "目标角色无效" };
  if (user.role === "store_manager" && toRole !== employee.role)
    return { ok: false, message: "店长发起调动时不可变更员工角色", code: 403 };
  if (
    !handover ||
    handover.id === employee.id ||
    handover.store_id !== employee.store_id ||
    !["agent", "store_manager"].includes(handover.role)
  )
    return { ok: false, message: "交接人须为原店其他在职经纪人或店长" };
  const pending = db
    .prepare(
      `SELECT id FROM employee_transfer_requests WHERE company_id=? AND user_id=?
       AND status IN ('pending','approved')`
    )
    .get(user.company_id, employee.id);
  if (pending) return { ok: false, message: "该员工已有未完成调动", code: 409 };
  const offboarding = db
    .prepare(
      `SELECT id FROM offboarding_tasks WHERE company_id=? AND user_id=? AND status='pending'`
    )
    .get(user.company_id, employee.id);
  if (offboarding) return { ok: false, message: "该员工存在待执行离职交接" };
  const snapshot = assets(db, user.company_id, employee.id);
  const id = nextId("TRF");
  const now = nowIso();
  db.prepare(
    `INSERT INTO employee_transfer_requests(
      id, company_id, user_id, from_store_id, to_store_id, from_role, to_role,
      handover_user_id, effective_date, reason, status, house_count,
      customer_count, key_count, role_count, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    employee.id,
    employee.store_id,
    targetStore.id,
    employee.role,
    toRole,
    handover.id,
    payload.effective_date,
    reason,
    snapshot.houses.length,
    snapshot.customers.length,
    snapshot.keys.length,
    snapshot.roles.length,
    user.id,
    now,
    now
  );
  const admins = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND role='admin' AND status='active'`
    )
    .all(user.company_id) as any[];
  for (const admin of admins) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: employee.store_id,
      user_id: admin.id,
      title: "员工调动待审批",
      body: `${employee.display_name} 申请调往 ${targetStore.name}`,
      kind: "employee_transfer",
      ref_type: "employee_transfer",
      ref_id: id,
    });
  }
  writeAudit(db, user, "employee_transfer.create", "employee_transfer", id, {
    user_id: employee.id,
    from_store_id: employee.store_id,
    to_store_id: targetStore.id,
    handover_user_id: handover.id,
  });
  return { ok: true, data: { id, status: "pending", snapshot } };
}

export function reviewTransfer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可审批调动", code: 403 };
  const row = db
    .prepare(`SELECT * FROM employee_transfer_requests WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "调动申请不存在" };
  if (row.status !== "pending") return { ok: false, message: "仅待审批调动可处理" };
  if (!["approved", "rejected"].includes(payload.status))
    return { ok: false, message: "审批状态无效" };
  const reason = String(payload.reason || "").trim();
  if (payload.status === "rejected" && !reason)
    return { ok: false, message: "驳回原因必填" };
  const now = nowIso();
  db.prepare(
    `UPDATE employee_transfer_requests SET status=?, reviewed_by=?,
     reviewed_at=?, reject_reason=?, updated_at=? WHERE id=?`
  ).run(payload.status, user.id, now, payload.status === "rejected" ? reason : null, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.from_store_id,
    user_id: row.user_id,
    title: payload.status === "approved" ? "员工调动已审批" : "员工调动已驳回",
    body: reason || `计划 ${row.effective_date} 生效`,
    kind: "employee_transfer",
    ref_type: "employee_transfer",
    ref_id: row.id,
  });
  writeAudit(db, user, `employee_transfer.${payload.status}`, "employee_transfer", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id, status: payload.status } };
}

export function executeTransfer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可执行调动", code: 403 };
  const row = db
    .prepare(`SELECT * FROM employee_transfer_requests WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.status !== "approved")
    return { ok: false, message: "仅已审批调动可执行" };
  if (row.effective_date > todayDate())
    return { ok: false, message: "尚未到调动生效日期" };
  const employee = db.prepare(`SELECT * FROM users WHERE id=?`).get(row.user_id) as any;
  const handover = db.prepare(`SELECT * FROM users WHERE id=?`).get(row.handover_user_id) as any;
  if (
    !employee ||
    employee.status !== "active" ||
    employee.store_id !== row.from_store_id ||
    !handover ||
    handover.status !== "active" ||
    handover.store_id !== row.from_store_id
  )
    return { ok: false, message: "员工或交接人状态已变化，请重新发起调动" };
  const snapshot = assets(db, user.company_id, employee.id);
  const now = nowIso();
  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE houses SET agent_id=?, locked_by=CASE WHEN locked_by=? THEN ? ELSE locked_by END,
       updated_at=? WHERE company_id=? AND agent_id=? AND status NOT IN ('closed','withdrawn')`
    ).run(handover.id, employee.id, handover.id, now, user.company_id, employee.id);
    db.prepare(
      `UPDATE customers SET agent_id=?, updated_at=? WHERE company_id=? AND agent_id=?
       AND status NOT IN ('closed','invalid') AND merged_into_id IS NULL`
    ).run(handover.id, now, user.company_id, employee.id);
    db.prepare(
      `UPDATE house_keys SET status=CASE WHEN borrower_user_id=? THEN 'stored' ELSE status END,
       returned_at=CASE WHEN borrower_user_id=? THEN ? ELSE returned_at END,
       borrower_user_id=CASE WHEN borrower_user_id=? THEN NULL ELSE borrower_user_id END,
       borrowed_at=CASE WHEN borrower_user_id=? THEN NULL ELSE borrowed_at END,
       expected_return_at=CASE WHEN borrower_user_id=? THEN NULL ELSE expected_return_at END,
       keeper_user_id=CASE WHEN keeper_user_id=? THEN ? ELSE keeper_user_id END,
       updated_at=? WHERE company_id=? AND (borrower_user_id=? OR keeper_user_id=?)`
    ).run(
      employee.id,
      employee.id,
      now,
      employee.id,
      employee.id,
      employee.id,
      employee.id,
      handover.id,
      now,
      user.company_id,
      employee.id,
      employee.id
    );
    db.prepare(
      `DELETE FROM house_role_holders WHERE company_id=? AND user_id=? AND EXISTS(
       SELECT 1 FROM house_role_holders r2 WHERE r2.house_id=house_role_holders.house_id
       AND r2.role_type=house_role_holders.role_type AND r2.user_id=?)`
    ).run(user.company_id, employee.id, handover.id);
    db.prepare(
      `UPDATE house_role_holders SET user_id=? WHERE company_id=? AND user_id=?`
    ).run(handover.id, user.company_id, employee.id);
    db.prepare(
      `UPDATE transfer_nodes SET assignee_user_id=?, updated_at=? WHERE company_id=?
       AND assignee_user_id=? AND status IN ('pending','in_progress')`
    ).run(handover.id, now, user.company_id, employee.id);
    db.prepare(
      `UPDATE business_records SET
       owner_user_id=CASE WHEN owner_user_id=? THEN ? ELSE owner_user_id END,
       assignee_user_id=CASE WHEN assignee_user_id=? THEN ? ELSE assignee_user_id END,
       updated_at=? WHERE company_id=? AND (owner_user_id=? OR assignee_user_id=?)
       AND status NOT IN ('completed','cancelled')`
    ).run(
      employee.id,
      handover.id,
      employee.id,
      handover.id,
      now,
      user.company_id,
      employee.id,
      employee.id
    );
    const assignment = db
      .prepare(
        `SELECT a.*, g.applicable_role FROM employee_job_assignments a
         JOIN job_grades g ON g.id=a.job_grade_id WHERE a.user_id=?`
      )
      .get(employee.id) as any;
    if (assignment?.applicable_role && assignment.applicable_role !== row.to_role) {
      db.prepare(`DELETE FROM employee_job_assignments WHERE user_id=?`).run(employee.id);
    }
    db.prepare(`UPDATE users SET store_id=?, role=? WHERE id=?`).run(
      row.to_store_id,
      row.to_role,
      employee.id
    );
    db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(employee.id);
    db.prepare(
      `UPDATE employee_transfer_requests SET status='completed', house_count=?,
       customer_count=?, key_count=?, role_count=?, updated_at=? WHERE id=?`
    ).run(
      snapshot.houses.length,
      snapshot.customers.length,
      snapshot.keys.length,
      snapshot.roles.length,
      now,
      row.id
    );
  });
  transaction();
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.to_store_id,
    user_id: employee.id,
    title: "员工调动已生效",
    body: `已调入新门店，原店资产已完成交接`,
    kind: "employee_transfer",
    ref_type: "employee_transfer",
    ref_id: row.id,
  });
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.from_store_id,
    user_id: handover.id,
    title: "员工调动资产交接完成",
    body: `已接收房源 ${snapshot.houses.length}、客源 ${snapshot.customers.length}、钥匙 ${snapshot.keys.length}`,
    kind: "employee_transfer",
    ref_type: "employee_transfer",
    ref_id: row.id,
  });
  writeAudit(db, user, "employee_transfer.execute", "employee_transfer", row.id, {
    user_id: employee.id,
    from_store_id: row.from_store_id,
    to_store_id: row.to_store_id,
    handover_user_id: handover.id,
    houses: snapshot.houses.length,
    customers: snapshot.customers.length,
    keys: snapshot.keys.length,
    roles: snapshot.roles.length,
  });
  return {
    ok: true,
    data: {
      id: row.id,
      status: "completed",
      houses: snapshot.houses.length,
      customers: snapshot.customers.length,
      keys: snapshot.keys.length,
      roles: snapshot.roles.length,
    },
  };
}

export function cancelTransfer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM employee_transfer_requests WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !transferVisible(user, row))
    return { ok: false, message: "调动申请不存在或无权限", code: 403 };
  if (row.status !== "pending") return { ok: false, message: "仅待审批调动可取消" };
  if (!(user.role === "admin" || row.created_by === user.id))
    return { ok: false, message: "仅发起人可取消", code: 403 };
  const now = nowIso();
  db.prepare(
    `UPDATE employee_transfer_requests SET status='cancelled', cancelled_at=?,
     updated_at=? WHERE id=?`
  ).run(now, now, row.id);
  writeAudit(db, user, "employee_transfer.cancel", "employee_transfer", row.id);
  return { ok: true, data: { id: row.id, status: "cancelled" } };
}
