import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function visible(user: SessionUser, deal: any): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  if (deal.store_id !== user.store_id) return false;
  if (user.role === "store_manager") return true;
  return (
    deal.created_by === user.id ||
    (JSON.parse(deal.agent_ids || "[]") as string[]).includes(user.id)
  );
}

export function listTemplates(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT * FROM deal_doc_templates
       WHERE company_id=? AND status='active' ORDER BY deal_type, sort_order, label`
    )
    .all(user.company_id) as any[];
  if (payload.deal_type) rows = rows.filter((row) => row.deal_type === payload.deal_type);
  return { ok: true, data: rows };
}

export function saveTemplate(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  if (!["sale", "rent"].includes(payload.deal_type) || !payload.category || !payload.label)
    return { ok: false, message: "资料模板信息不完整" };
  const now = nowIso();
  const current = db
    .prepare(
      `SELECT id FROM deal_doc_templates
       WHERE company_id=? AND deal_type=? AND category=?`
    )
    .get(user.company_id, payload.deal_type, payload.category) as any;
  const id = current?.id || nextId("DCT");
  db.prepare(
    `INSERT INTO deal_doc_templates(
       id, company_id, deal_type, category, label, required, status,
       sort_order, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
     ON CONFLICT(company_id, deal_type, category) DO UPDATE SET
       label=excluded.label, required=excluded.required, status='active',
       sort_order=excluded.sort_order, updated_at=excluded.updated_at`
  ).run(
    id,
    user.company_id,
    payload.deal_type,
    String(payload.category).trim(),
    String(payload.label).trim(),
    payload.required === false ? 0 : 1,
    Number(payload.sort_order || 0),
    user.id,
    now,
    now
  );
  writeAudit(db, user, "deal_document.template", "deal_doc_template", id, payload);
  return { ok: true, data: { id } };
}

export function initForDeal(db: Db, dealId: string): number {
  const deal = db.prepare(`SELECT * FROM deals WHERE id=?`).get(dealId) as any;
  if (!deal) return 0;
  const templates = db
    .prepare(
      `SELECT * FROM deal_doc_templates
       WHERE company_id=? AND deal_type=? AND status='active' ORDER BY sort_order`
    )
    .all(deal.company_id, deal.deal_type) as any[];
  const now = nowIso();
  let created = 0;
  for (const template of templates) {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO deal_doc_items(
           id, company_id, store_id, deal_id, category, label, required,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        nextId("DCI"),
        deal.company_id,
        deal.store_id,
        deal.id,
        template.category,
        template.label,
        template.required,
        now,
        now
      );
    created += result.changes;
  }
  return created;
}

export function initChecklist(db: Db, user: SessionUser, payload: any): ApiResult {
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`)
    .get(payload.deal_id, user.company_id) as any;
  if (!deal || !visible(user, deal))
    return { ok: false, message: "成交单不存在或无权限", code: 403 };
  const created = initForDeal(db, deal.id);
  writeAudit(db, user, "deal_document.init", "deal", deal.id, { created });
  return { ok: true, data: { created } };
}

export function listItems(db: Db, user: SessionUser, payload: any): ApiResult {
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`)
    .get(payload.deal_id, user.company_id) as any;
  if (!deal || !visible(user, deal))
    return { ok: false, message: "成交单不存在或无权限", code: 403 };
  initForDeal(db, deal.id);
  const rows = db
    .prepare(
      `SELECT i.*, a.name AS attachment_name
       FROM deal_doc_items i
       LEFT JOIN file_attachments a ON a.id=i.attachment_id
       WHERE i.deal_id=? ORDER BY i.required DESC, i.created_at`
    )
    .all(deal.id) as any[];
  const required = rows.filter((row) => Boolean(row.required));
  const received = required.filter((row) => row.status === "received");
  return {
    ok: true,
    data: {
      items: rows,
      required_count: required.length,
      received_count: received.length,
      complete: required.every((row) => row.status === "received"),
    },
  };
}

export function markReceived(
  db: Db,
  dealId: string,
  category: string,
  attachmentId: string,
  userId: string
): void {
  db.prepare(
    `UPDATE deal_doc_items SET status='received', attachment_id=?,
     received_by=?, received_at=?, updated_at=?
     WHERE deal_id=? AND category=?`
  ).run(attachmentId, userId, nowIso(), nowIso(), dealId, category);
}

export function readiness(db: Db, dealId: string): { ready: boolean; missing: string[] } {
  initForDeal(db, dealId);
  const missing = db
    .prepare(
      `SELECT label FROM deal_doc_items
       WHERE deal_id=? AND required=1 AND status<>'received' ORDER BY created_at`
    )
    .all(dealId)
    .map((row: any) => row.label);
  return { ready: missing.length === 0, missing };
}
