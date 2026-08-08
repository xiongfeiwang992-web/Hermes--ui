import type { Db } from "../db/database";
import { nextId, nowIso } from "../utils/id";
import type { SessionUser } from "../utils/types";

export function createMessage(
  db: Db,
  input: {
    company_id: string;
    store_id?: string | null;
    user_id: string;
    title: string;
    body: string;
    kind: string;
    ref_type?: string;
    ref_id?: string;
  }
): void {
  db.prepare(
    `INSERT INTO messages(id, company_id, store_id, user_id, title, body, kind, ref_type, ref_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    nextId("MSG"),
    input.company_id,
    input.store_id || null,
    input.user_id,
    input.title,
    input.body,
    input.kind,
    input.ref_type || null,
    input.ref_id || null,
    nowIso()
  );
}

export function listMessages(db: Db, user: SessionUser) {
  return db
    .prepare(
      `SELECT * FROM messages WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 100`
    )
    .all(user.company_id, user.id);
}

export function unreadCount(db: Db, user: SessionUser): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages WHERE company_id = ? AND user_id = ? AND is_read = 0`
    )
    .get(user.company_id, user.id) as { c: number };
  return row.c;
}

export function markRead(db: Db, user: SessionUser, id?: string) {
  if (id) {
    db.prepare(
      `UPDATE messages SET is_read = 1 WHERE id = ? AND user_id = ? AND company_id = ?`
    ).run(id, user.id, user.company_id);
  } else {
    db.prepare(
      `UPDATE messages SET is_read = 1 WHERE user_id = ? AND company_id = ?`
    ).run(user.id, user.company_id);
  }
  return { ok: true };
}
