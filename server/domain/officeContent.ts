import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const KINDS = new Set(["announcement", "knowledge"]);
const CATEGORIES = new Set(["news", "policy", "training", "process", "other"]);

function inScope(user: SessionUser, row: any): boolean {
  return row.scope_type === "company" || row.store_id === user.store_id;
}

function canManage(user: SessionUser, row: any): boolean {
  return (
    user.role === "admin" ||
    (user.role === "store_manager" &&
      row.scope_type === "store" &&
      row.store_id === user.store_id)
  );
}

function visible(user: SessionUser, row: any): boolean {
  if (canManage(user, row)) return true;
  return row.status === "published" && inScope(user, row);
}

function addVersion(db: Db, user: SessionUser, row: any) {
  db.prepare(
    `INSERT INTO office_document_versions(
      id, company_id, document_id, version_no, title, content, changed_by, changed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("ODV"),
    user.company_id,
    row.id,
    row.version_no,
    row.title,
    row.content,
    user.id,
    nowIso()
  );
}

export function officeContentOptions(db: Db, user: SessionUser): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: true, data: { stores: [] } };
  let stores = db
    .prepare(`SELECT id, name FROM stores WHERE company_id=? AND status='active' ORDER BY name`)
    .all(user.company_id) as any[];
  if (user.role === "store_manager")
    stores = stores.filter((store) => store.id === user.store_id);
  return { ok: true, data: { stores } };
}

export function listDocuments(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT d.*, s.name AS store_name, creator.display_name AS creator_name,
       (SELECT COUNT(*) FROM office_document_reads r WHERE r.document_id=d.id) AS read_count,
       EXISTS(SELECT 1 FROM office_document_reads r
        WHERE r.document_id=d.id AND r.user_id=?) AS is_read,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='office_document' AND a.parent_id=d.id) AS attachment_count
       FROM office_documents d
       LEFT JOIN stores s ON s.id=d.store_id
       JOIN users creator ON creator.id=d.created_by
       WHERE d.company_id=?
       ORDER BY d.is_pinned DESC, d.published_at DESC, d.updated_at DESC`
    )
    .all(user.id, user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row));
  if (payload.document_kind)
    rows = rows.filter((row) => row.document_kind === payload.document_kind);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.category) rows = rows.filter((row) => row.category === payload.category);
  return { ok: true, data: rows };
}

export function createDocument(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无创建权限", code: 403 };
  if (!KINDS.has(payload.document_kind)) return { ok: false, message: "文档类型无效" };
  if (!CATEGORIES.has(payload.category)) return { ok: false, message: "文档分类无效" };
  const title = String(payload.title || "").trim();
  const content = String(payload.content || "").trim();
  if (!title || !content) return { ok: false, message: "标题和正文必填" };
  const scopeType = user.role === "admin" ? payload.scope_type || "company" : "store";
  if (!["company", "store"].includes(scopeType)) return { ok: false, message: "发布范围无效" };
  let storeId: string | null = null;
  if (scopeType === "store") {
    storeId = user.role === "admin" ? payload.store_id : user.store_id;
    const store = db
      .prepare(`SELECT id FROM stores WHERE id=? AND company_id=? AND status='active'`)
      .get(storeId, user.company_id);
    if (!store) return { ok: false, message: "发布门店无效" };
  }
  const id = nextId("DOC");
  const now = nowIso();
  db.prepare(
    `INSERT INTO office_documents(
      id, company_id, store_id, document_kind, scope_type, category,
      title, content, status, is_pinned, version_no, created_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, 1, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    storeId,
    payload.document_kind,
    scopeType,
    payload.category,
    title,
    content,
    payload.is_pinned ? 1 : 0,
    user.id,
    now,
    now
  );
  addVersion(db, user, {
    id,
    version_no: 1,
    title,
    content,
  });
  writeAudit(db, user, "office_document.create", "office_document", id, {
    kind: payload.document_kind,
    scope_type: scopeType,
    store_id: storeId,
  });
  return { ok: true, data: { id, status: "draft", version_no: 1 } };
}

export function updateDocument(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM office_documents WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManage(user, row))
    return { ok: false, message: "文档不存在或无权限", code: 403 };
  if (row.status === "archived") return { ok: false, message: "归档文档不可修改" };
  const title = String(payload.title ?? row.title).trim();
  const content = String(payload.content ?? row.content).trim();
  if (!title || !content) return { ok: false, message: "标题和正文必填" };
  if (payload.category && !CATEGORIES.has(payload.category))
    return { ok: false, message: "文档分类无效" };
  const version = Number(row.version_no) + 1;
  const now = nowIso();
  db.prepare(
    `UPDATE office_documents SET title=?, content=?, category=?,
     is_pinned=?, version_no=?, status='draft', published_by=NULL,
     published_at=NULL, updated_at=? WHERE id=?`
  ).run(
    title,
    content,
    payload.category || row.category,
    payload.is_pinned == null ? row.is_pinned : payload.is_pinned ? 1 : 0,
    version,
    now,
    row.id
  );
  addVersion(db, user, { id: row.id, version_no: version, title, content });
  writeAudit(db, user, "office_document.update", "office_document", row.id, {
    version_no: version,
  });
  let recipients = db
    .prepare(
      `SELECT id, store_id, role FROM users WHERE company_id=? AND status='active'
       AND role IN ('admin', 'store_manager')`
    )
    .all(user.company_id) as any[];
  if (row.store_id)
    recipients = recipients.filter(
      (recipient) => recipient.role === "admin" || recipient.store_id === row.store_id
    );
  const kindLabel = row.document_kind === "announcement" ? "公告" : "知识";
  for (const recipient of recipients) {
    if (recipient.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id || recipient.store_id,
      user_id: recipient.id,
      title: `${kindLabel}草稿已更新`,
      body: `${title} · v${version}`,
      kind: "office_announcement",
      ref_type: "office_document",
      ref_id: row.id,
    });
  }
  return { ok: true, data: { id: row.id, status: "draft", version_no: version } };
}

export function publishDocument(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM office_documents WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManage(user, row))
    return { ok: false, message: "文档不存在或无权限", code: 403 };
  if (row.status !== "draft") return { ok: false, message: "仅草稿可发布" };
  const now = nowIso();
  db.prepare(
    `UPDATE office_documents SET status='published', published_by=?,
     published_at=?, updated_at=? WHERE id=?`
  ).run(user.id, now, now, row.id);
  if (row.document_kind === "announcement") {
    let recipients = db
      .prepare(
        `SELECT id, store_id FROM users WHERE company_id=? AND status='active' AND id<>?`
      )
      .all(user.company_id, user.id) as any[];
    if (row.scope_type === "store")
      recipients = recipients.filter((recipient) => recipient.store_id === row.store_id);
    for (const recipient of recipients) {
      createMessage(db, {
        company_id: user.company_id,
        store_id: row.store_id,
        user_id: recipient.id,
        title: "新公告发布",
        body: row.title,
        kind: "office_announcement",
        ref_type: "office_document",
        ref_id: row.id,
      });
    }
  }
  writeAudit(db, user, "office_document.publish", "office_document", row.id, {
    version_no: row.version_no,
  });
  return { ok: true, data: { id: row.id, status: "published" } };
}

export function archiveDocument(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM office_documents WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManage(user, row))
    return { ok: false, message: "文档不存在或无权限", code: 403 };
  if (row.status !== "published") return { ok: false, message: "仅已发布文档可归档" };
  const now = nowIso();
  db.prepare(
    `UPDATE office_documents SET status='archived', archived_by=?,
     archived_at=?, updated_at=? WHERE id=?`
  ).run(user.id, now, now, row.id);
  writeAudit(db, user, "office_document.archive", "office_document", row.id);
  return { ok: true, data: { id: row.id, status: "archived" } };
}

export function markDocumentRead(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM office_documents WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.status !== "published" || !inScope(user, row))
    return { ok: false, message: "文档不存在或不可阅读", code: 403 };
  const now = nowIso();
  db.prepare(
    `INSERT INTO office_document_reads(
      id, company_id, document_id, user_id, read_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(document_id, user_id) DO UPDATE SET read_at=excluded.read_at`
  ).run(nextId("ODR"), user.company_id, row.id, user.id, now);
  return { ok: true, data: { id: row.id, read_at: now } };
}

export function unreadDocuments(db: Db, user: SessionUser): ApiResult {
  const rows = db
    .prepare(
      `SELECT d.* FROM office_documents d WHERE d.company_id=?
       AND d.status='published' AND NOT EXISTS(
         SELECT 1 FROM office_document_reads r
         WHERE r.document_id=d.id AND r.user_id=?
       )`
    )
    .all(user.company_id, user.id) as any[];
  const visibleRows = rows.filter((row) => inScope(user, row));
  return {
    ok: true,
    data: {
      count: visibleRows.length,
      announcements: visibleRows.filter((row) => row.document_kind === "announcement").length,
      knowledge: visibleRows.filter((row) => row.document_kind === "knowledge").length,
    },
  };
}

export function listVersions(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM office_documents WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !visible(user, row))
    return { ok: false, message: "文档不存在或无权限", code: 403 };
  const versions = db
    .prepare(
      `SELECT v.*, u.display_name AS changed_by_name FROM office_document_versions v
       JOIN users u ON u.id=v.changed_by WHERE v.document_id=? ORDER BY v.version_no DESC`
    )
    .all(row.id);
  return { ok: true, data: versions };
}
