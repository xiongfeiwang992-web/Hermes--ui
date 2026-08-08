import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

export function listAttachments(db: Db, user: SessionUser, payload: any): ApiResult {
  const rows = db
    .prepare(
      `SELECT * FROM file_attachments
       WHERE company_id = ? AND parent_type = ? AND parent_id = ?
       ORDER BY created_at DESC`
    )
    .all(user.company_id, payload.parent_type, payload.parent_id) as any[];
  return {
    ok: true,
    data: rows.filter(
      (row) =>
        user.role === "admin" ||
        user.role === "finance" ||
        !row.store_id ||
        row.store_id === user.store_id
    ),
  };
}

export function addAttachment(db: Db, user: SessionUser, payload: any): ApiResult {
  const localPath = path.resolve(String(payload.local_path || ""));
  if (!payload.parent_type || !payload.parent_id || !payload.category || !payload.name) {
    return { ok: false, message: "附件信息不完整" };
  }
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
    return { ok: false, message: "本地文件不存在" };
  }
  const stat = fs.statSync(localPath);
  const id = nextId("ATT");
  db.prepare(
    `INSERT INTO file_attachments(
      id, company_id, store_id, parent_type, parent_id, category,
      name, local_path, mime_type, size_bytes, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    payload.parent_type,
    payload.parent_id,
    payload.category,
    payload.name,
    localPath,
    payload.mime_type || null,
    stat.size,
    user.id,
    nowIso()
  );
  writeAudit(db, user, "attachment.add", "attachment", id, {
    parent_type: payload.parent_type,
    parent_id: payload.parent_id,
    category: payload.category,
    size: stat.size,
  });
  return { ok: true, data: { id, size: stat.size } };
}
