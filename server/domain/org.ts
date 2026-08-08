import type { Db } from "../db/database";
import { canManageOrg } from "../auth/policy";
import { writeAudit } from "./audit";
import { hashPassword, verifyPassword } from "../utils/password";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, Role, SessionUser } from "../utils/types";
import { randomBytes } from "node:crypto";


function passwordChangedAt(row: any): string {
  return row.password_changed_at || row.created_at;
}

export function isPasswordExpired(db: Db, userId: string): boolean {
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
  if (!row) return false;
  const settings = db
    .prepare(`SELECT password_max_age_days FROM settings WHERE company_id = ?`)
    .get(row.company_id) as any;
  const days = Number(settings?.password_max_age_days || 0);
  if (!Number.isInteger(days) || days <= 0) return false;
  const changedMs = Date.parse(passwordChangedAt(row));
  if (!Number.isFinite(changedMs)) return false;
  return Date.now() > changedMs + days * 24 * 3600 * 1000;
}

function toUser(row: any): SessionUser {
  return {
    id: row.id,
    company_id: row.company_id,
    store_id: row.store_id,
    account: row.account,
    display_name: row.display_name,
    role: row.role,
    phone: row.phone,
    status: row.status,
  };
}

export function login(
  db: Db,
  account: string,
  password: string
): ApiResult<{ token: string; user: SessionUser }> {
  const row = db
    .prepare(`SELECT * FROM users WHERE account = ? AND status = 'active'`)
    .get(account) as any;
  if (!row || !verifyPassword(password, row.password_hash)) {
    return { ok: false, message: "账号或密码错误", code: 401 };
  }
  const token = randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  ).run(token, row.id, nowIso(), expires);
  const user = toUser(row);
  writeAudit(db, user, "auth.login", "user", row.id);
  return {
    ok: true,
    data: {
      token,
      user,
      must_change_password: isPasswordExpired(db, row.id),
    },
  };
}

export function logout(db: Db, token: string | null, user: SessionUser | null): ApiResult {
  if (token) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  if (user) writeAudit(db, user, "auth.logout", "user", user.id);
  return { ok: true, data: true };
}

export function getSession(db: Db, token: string | null): SessionUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.status = 'active'`
    )
    .get(token, nowIso()) as any;
  return row ? toUser(row) : null;
}

export function listStores(db: Db, user: SessionUser): ApiResult {
  if (!canManageOrg(user) && user.role !== "store_manager") {
    return { ok: false, message: "无权限", code: 403 };
  }
  const rows =
    user.role === "admin"
      ? db
          .prepare(`SELECT * FROM stores WHERE company_id = ? ORDER BY created_at`)
          .all(user.company_id)
      : db
          .prepare(`SELECT * FROM stores WHERE company_id = ? AND id = ?`)
          .all(user.company_id, user.store_id);
  return { ok: true, data: rows };
}

export function upsertStore(
  db: Db,
  user: SessionUser,
  payload: { id?: string; name: string; address?: string; status?: string }
): ApiResult {
  if (!canManageOrg(user)) return { ok: false, message: "无权限", code: 403 };
  if (!payload.name?.trim()) return { ok: false, message: "门店名称必填" };
  if (payload.id) {
    db.prepare(
      `UPDATE stores SET name = ?, address = ?, status = COALESCE(?, status) WHERE id = ? AND company_id = ?`
    ).run(
      payload.name.trim(),
      payload.address || null,
      payload.status || null,
      payload.id,
      user.company_id
    );
    writeAudit(db, user, "store.update", "store", payload.id, payload);
    return { ok: true, data: { id: payload.id } };
  }
  const id = nextId("ST");
  db.prepare(
    `INSERT INTO stores(id, company_id, name, address, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`
  ).run(id, user.company_id, payload.name.trim(), payload.address || null, nowIso());
  writeAudit(db, user, "store.create", "store", id, payload);
  return { ok: true, data: { id } };
}

export function listUsers(db: Db, user: SessionUser): ApiResult {
  if (!canManageOrg(user)) return { ok: false, message: "无权限", code: 403 };
  const rows = db
    .prepare(
      `SELECT id, company_id, store_id, account, display_name, role, phone, status, created_at
       FROM users WHERE company_id = ? ORDER BY created_at`
    )
    .all(user.company_id);
  return { ok: true, data: rows };
}

export function listStoreUsers(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  const rows =
    user.role === "admin"
      ? db
          .prepare(
            `SELECT id, store_id, display_name, role FROM users
             WHERE company_id = ? AND status = 'active' ORDER BY display_name`
          )
          .all(user.company_id)
      : db
          .prepare(
            `SELECT id, store_id, display_name, role FROM users
             WHERE company_id = ? AND store_id = ? AND status = 'active'
             ORDER BY display_name`
          )
          .all(user.company_id, user.store_id);
  return { ok: true, data: rows };
}

export function upsertUser(
  db: Db,
  user: SessionUser,
  payload: {
    id?: string;
    account: string;
    display_name: string;
    role: Role;
    store_id: string;
    phone?: string;
    password?: string;
    status?: string;
  }
): ApiResult {
  if (!canManageOrg(user)) return { ok: false, message: "无权限", code: 403 };
  if (!payload.account || !payload.display_name || !payload.role || !payload.store_id) {
    return { ok: false, message: "员工信息不完整" };
  }
  const policy = db
    .prepare(`SELECT password_min_length FROM settings WHERE company_id = ?`)
    .get(user.company_id) as any;
  if (payload.password && payload.password.length < Number(policy?.password_min_length || 8)) {
    return {
      ok: false,
      message: `密码至少 ${Number(policy?.password_min_length || 8)} 位`,
    };
  }
  const store = db
    .prepare(`SELECT * FROM stores WHERE id = ? AND company_id = ?`)
    .get(payload.store_id, user.company_id) as any;
  if (!store || store.status !== "active") {
    return { ok: false, message: "门店无效或已停用" };
  }
  if (payload.id) {
    const existing = db
      .prepare(`SELECT * FROM users WHERE id = ? AND company_id = ?`)
      .get(payload.id, user.company_id) as any;
    if (!existing) return { ok: false, message: "员工不存在" };
    const passwordHash = payload.password
      ? hashPassword(payload.password)
      : existing.password_hash;
    const changedAt = payload.password ? nowIso() : existing.password_changed_at || existing.created_at;
    db.prepare(
      `UPDATE users SET account = ?, display_name = ?, role = ?, store_id = ?, phone = ?, password_hash = ?,
       password_changed_at = ?, status = COALESCE(?, status)
       WHERE id = ? AND company_id = ?`
    ).run(
      payload.account,
      payload.display_name,
      payload.role,
      payload.store_id,
      payload.phone || null,
      passwordHash,
      changedAt,
      payload.status || null,
      payload.id,
      user.company_id
    );
    writeAudit(db, user, "user.update", "user", payload.id, {
      account: payload.account,
      role: payload.role,
    });
    return { ok: true, data: { id: payload.id } };
  }
  if (!payload.password) return { ok: false, message: "新建员工须设置密码" };
  const id = nextId("USR");
  try {
    const created = nowIso();
    db.prepare(
      `INSERT INTO users(id, company_id, store_id, account, display_name, password_hash, role, phone, status, created_at, password_changed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).run(
      id,
      user.company_id,
      payload.store_id,
      payload.account,
      payload.display_name,
      hashPassword(payload.password),
      payload.role,
      payload.phone || null,
      created,
      created
    );
  } catch {
    return { ok: false, message: "账号已存在", code: 409 };
  }
  writeAudit(db, user, "user.create", "user", id, {
    account: payload.account,
    role: payload.role,
  });
  return { ok: true, data: { id } };
}

export function me(db: Db, user: SessionUser): ApiResult {
  return {
    ok: true,
    data: {
      ...user,
      must_change_password: isPasswordExpired(db, user.id),
    },
  };
}

export function changePassword(
  db: Db,
  user: SessionUser,
  payload: { current_password: string; new_password: string }
): ApiResult {
  const policy = db
    .prepare(`SELECT password_min_length FROM settings WHERE company_id = ?`)
    .get(user.company_id) as any;
  const minLength = Number(policy?.password_min_length || 8);
  if (String(payload.new_password || "").length < minLength) {
    return { ok: false, message: `新密码至少 ${minLength} 位` };
  }
  const row = db
    .prepare(`SELECT password_hash FROM users WHERE id = ? AND company_id = ?`)
    .get(user.id, user.company_id) as any;
  if (!row || !verifyPassword(payload.current_password || "", row.password_hash)) {
    return { ok: false, message: "当前密码错误" };
  }
  const now = nowIso();
  db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?`).run(
    hashPassword(payload.new_password),
    now,
    user.id
  );
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
  writeAudit(db, user, "auth.password_change", "user", user.id);
  return { ok: true, data: { relogin_required: true } };
}
