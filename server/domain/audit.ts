import type { Db } from "../db/database";
import { nextId, nowIso } from "../utils/id";
import type { SessionUser } from "../utils/types";

export function writeAudit(
  db: Db,
  user: SessionUser | null,
  action: string,
  targetType?: string,
  targetId?: string,
  detail?: unknown
): void {
  db.prepare(
    `INSERT INTO audit_logs(id, company_id, store_id, user_id, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("AUD"),
    user?.company_id || "unknown",
    user?.store_id || null,
    user?.id || null,
    action,
    targetType || null,
    targetId || null,
    detail ? JSON.stringify(detail) : null,
    nowIso()
  );
}

export function listAudit(db: Db, user: SessionUser, limit = 100) {
  if (user.role === "admin") {
    return db
      .prepare(
        `SELECT * FROM audit_logs WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(user.company_id, limit);
  }
  if (user.role === "store_manager") {
    return db
      .prepare(
        `SELECT * FROM audit_logs WHERE company_id = ? AND store_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(user.company_id, user.store_id, limit);
  }
  return [];
}
