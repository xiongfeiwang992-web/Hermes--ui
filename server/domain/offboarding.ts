import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function canManage(user: SessionUser, storeId: string): boolean {
  return user.role === "admin" || (user.role === "store_manager" && user.store_id === storeId);
}

function assets(db: Db, companyId: string, userId: string) {
  const houses = db
    .prepare(
      `SELECT id, title, status FROM houses WHERE company_id=? AND agent_id=?
       AND status NOT IN ('closed','withdrawn') ORDER BY title`
    )
    .all(companyId, userId) as any[];
  const customers = db
    .prepare(
      `SELECT id, name, status FROM customers WHERE company_id=? AND agent_id=?
       AND status NOT IN ('closed','invalid') AND merged_into_id IS NULL ORDER BY name`
    )
    .all(companyId, userId) as any[];
  const keys = db
    .prepare(
      `SELECT id, key_no, status FROM house_keys WHERE company_id=?
       AND (borrower_user_id=? OR keeper_user_id=?) ORDER BY key_no`
    )
    .all(companyId, userId, userId) as any[];
  const roles = db
    .prepare(
      `SELECT r.id, r.role_type, h.title AS house_title
       FROM house_role_holders r JOIN houses h ON h.id=r.house_id
       WHERE r.company_id=? AND r.user_id=? ORDER BY r.role_type`
    )
    .all(companyId, userId) as any[];
  return { houses, customers, keys, roles };
}

export function previewOffboarding(db: Db, user: SessionUser, payload: any): ApiResult {
  const employee = db
    .prepare(
      `SELECT id, store_id, display_name, role, status FROM users
       WHERE id=? AND company_id=?`
    )
    .get(payload.user_id, user.company_id) as any;
  if (!employee || !canManage(user, employee.store_id))
    return { ok: false, message: "员工不存在或无权限", code: 403 };
  return { ok: true, data: { employee, ...assets(db, user.company_id, employee.id) } };
}

export function listOffboarding(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT t.*, u.display_name AS employee_name, target.display_name AS target_name,
       creator.display_name AS created_by_name
       FROM offboarding_tasks t
       JOIN users u ON u.id=t.user_id
       JOIN users target ON target.id=t.target_user_id
       JOIN users creator ON creator.id=t.created_by
       WHERE t.company_id=? ORDER BY t.created_at DESC`
    )
    .all(user.company_id) as any[];
  if (user.role === "store_manager") rows = rows.filter((row) => row.store_id === user.store_id);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function startOffboarding(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "离职原因必填" };
  if (!payload.user_id || payload.user_id === payload.target_user_id)
    return { ok: false, message: "离职员工与接收人须不同" };
  const employee = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=?`)
    .get(payload.user_id, user.company_id) as any;
  const target = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=?`)
    .get(payload.target_user_id, user.company_id) as any;
  if (
    !employee ||
    employee.status !== "active" ||
    employee.role === "admin" ||
    employee.id === user.id ||
    !canManage(user, employee.store_id)
  )
    return { ok: false, message: "离职员工无效或无权限", code: 403 };
  if (
    !target ||
    target.status !== "active" ||
    target.store_id !== employee.store_id ||
    !["agent", "store_manager"].includes(target.role)
  )
    return { ok: false, message: "接收人须为同店在职经纪人或店长" };
  const pending = db
    .prepare(
      `SELECT id FROM offboarding_tasks
       WHERE company_id=? AND user_id=? AND status='pending'`
    )
    .get(user.company_id, employee.id);
  if (pending) return { ok: false, message: "该员工已有待执行交接任务", code: 409 };
  const snapshot = assets(db, user.company_id, employee.id);
  const id = nextId("OFF");
  const now = nowIso();
  db.prepare(
    `INSERT INTO offboarding_tasks(
       id, company_id, store_id, user_id, target_user_id, status, reason,
       house_count, customer_count, key_count, role_count,
       created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    employee.store_id,
    employee.id,
    target.id,
    reason,
    snapshot.houses.length,
    snapshot.customers.length,
    snapshot.keys.length,
    snapshot.roles.length,
    user.id,
    now,
    now
  );
  createMessage(db, {
    company_id: user.company_id,
    store_id: employee.store_id,
    user_id: target.id,
    title: "收到离职交接任务",
    body: `${employee.display_name} 的房客与钥匙待交接`,
    kind: "offboarding",
    ref_type: "offboarding_task",
    ref_id: id,
  });
  writeAudit(db, user, "offboarding.start", "offboarding_task", id, {
    user_id: employee.id,
    target_user_id: target.id,
  });
  return { ok: true, data: { id, snapshot } };
}

export function executeOffboarding(db: Db, user: SessionUser, payload: any): ApiResult {
  const task = db
    .prepare(`SELECT * FROM offboarding_tasks WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!task || !canManage(user, task.store_id))
    return { ok: false, message: "交接任务不存在或无权限", code: 403 };
  if (task.status !== "pending") return { ok: false, message: "交接任务已处理" };
  const employee = db.prepare(`SELECT * FROM users WHERE id=?`).get(task.user_id) as any;
  const target = db.prepare(`SELECT * FROM users WHERE id=?`).get(task.target_user_id) as any;
  if (!employee || employee.status !== "active")
    return { ok: false, message: "离职员工已非在职状态" };
  if (!target || target.status !== "active" || target.store_id !== task.store_id)
    return { ok: false, message: "接收人已失效" };
  const snapshot = assets(db, user.company_id, employee.id);
  const now = nowIso();
  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE houses SET agent_id=?, locked_by=CASE WHEN locked_by=? THEN ? ELSE locked_by END,
       updated_at=? WHERE company_id=? AND agent_id=? AND status NOT IN ('closed','withdrawn')`
    ).run(target.id, employee.id, target.id, now, user.company_id, employee.id);
    db.prepare(
      `UPDATE customers SET agent_id=?, updated_at=?
       WHERE company_id=? AND agent_id=? AND status NOT IN ('closed','invalid')
       AND merged_into_id IS NULL`
    ).run(target.id, now, user.company_id, employee.id);
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
      target.id,
      now,
      user.company_id,
      employee.id,
      employee.id
    );
    db.prepare(
      `DELETE FROM house_role_holders
       WHERE company_id=? AND user_id=? AND EXISTS(
         SELECT 1 FROM house_role_holders r2
         WHERE r2.house_id=house_role_holders.house_id
         AND r2.role_type=house_role_holders.role_type AND r2.user_id=?
       )`
    ).run(user.company_id, employee.id, target.id);
    db.prepare(
      `UPDATE house_role_holders SET user_id=?
       WHERE company_id=? AND user_id=?`
    ).run(target.id, user.company_id, employee.id);
    db.prepare(
      `UPDATE transfer_nodes SET assignee_user_id=?, updated_at=?
       WHERE company_id=? AND assignee_user_id=? AND status IN ('pending','in_progress')`
    ).run(target.id, now, user.company_id, employee.id);
    db.prepare(
      `UPDATE business_records SET owner_user_id=CASE WHEN owner_user_id=? THEN ? ELSE owner_user_id END,
       assignee_user_id=CASE WHEN assignee_user_id=? THEN ? ELSE assignee_user_id END,
       updated_at=? WHERE company_id=? AND (owner_user_id=? OR assignee_user_id=?)
       AND status NOT IN ('completed','cancelled')`
    ).run(
      employee.id,
      target.id,
      employee.id,
      target.id,
      now,
      user.company_id,
      employee.id,
      employee.id
    );
    db.prepare(`UPDATE users SET status='inactive' WHERE id=?`).run(employee.id);
    db.prepare(`DELETE FROM sessions WHERE user_id=?`).run(employee.id);
    db.prepare(
      `UPDATE offboarding_tasks SET status='completed', house_count=?,
       customer_count=?, key_count=?, role_count=?, completed_at=?, updated_at=?
       WHERE id=?`
    ).run(
      snapshot.houses.length,
      snapshot.customers.length,
      snapshot.keys.length,
      snapshot.roles.length,
      now,
      now,
      task.id
    );
  });
  transaction();
  createMessage(db, {
    company_id: user.company_id,
    store_id: task.store_id,
    user_id: target.id,
    title: "离职交接已完成",
    body: `已接收房源 ${snapshot.houses.length}、客源 ${snapshot.customers.length}、钥匙 ${snapshot.keys.length}`,
    kind: "offboarding",
    ref_type: "offboarding_task",
    ref_id: task.id,
  });
  writeAudit(db, user, "offboarding.execute", "offboarding_task", task.id, {
    user_id: employee.id,
    target_user_id: target.id,
    houses: snapshot.houses.length,
    customers: snapshot.customers.length,
    keys: snapshot.keys.length,
    roles: snapshot.roles.length,
  });
  return {
    ok: true,
    data: {
      id: task.id,
      houses: snapshot.houses.length,
      customers: snapshot.customers.length,
      keys: snapshot.keys.length,
      roles: snapshot.roles.length,
    },
  };
}

export function cancelOffboarding(db: Db, user: SessionUser, payload: any): ApiResult {
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "取消原因必填" };
  const task = db
    .prepare(`SELECT * FROM offboarding_tasks WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!task || !canManage(user, task.store_id))
    return { ok: false, message: "交接任务不存在或无权限", code: 403 };
  if (task.status !== "pending") return { ok: false, message: "仅待执行任务可取消" };
  const now = nowIso();
  db.prepare(
    `UPDATE offboarding_tasks SET status='cancelled', cancelled_at=?,
     cancel_reason=?, updated_at=? WHERE id=?`
  ).run(now, reason, now, task.id);
  writeAudit(db, user, "offboarding.cancel", "offboarding_task", task.id, { reason });
  return { ok: true, data: { id: task.id } };
}
