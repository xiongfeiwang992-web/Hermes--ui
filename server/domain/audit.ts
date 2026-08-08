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

export function listAudit(db: Db, user: SessionUser, query: any = {}) {
  const limit = Math.min(500, Math.max(1, Number(query.limit || 100)));
  let rows: any[] = [];
  if (user.role === "admin") {
    rows = db
      .prepare(
        `SELECT * FROM audit_logs WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(user.company_id, limit) as any[];
  } else if (user.role === "store_manager") {
    rows = db
      .prepare(
        `SELECT * FROM audit_logs WHERE company_id = ? AND store_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(user.company_id, user.store_id, limit) as any[];
  }
  if (query.user_id) rows = rows.filter((row) => row.user_id === query.user_id);
  if (query.action) rows = rows.filter((row) => row.action.includes(query.action));
  if (query.target_type)
    rows = rows.filter((row) => row.target_type === query.target_type);
  if (query.start_at) rows = rows.filter((row) => row.created_at >= query.start_at);
  if (query.end_at) rows = rows.filter((row) => row.created_at <= query.end_at);
  return rows;
}
