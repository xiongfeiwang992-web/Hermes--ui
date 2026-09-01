import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

export function templates(db: Db, user: SessionUser): ApiResult {
  return {
    ok: true,
    data: db
      .prepare(`SELECT * FROM contract_templates WHERE company_id=? AND status='active' ORDER BY name`)
      .all(user.company_id),
  };
}

export function saveTemplate(db: Db, user: SessionUser, p: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  if (!p.name || !p.content || !["sale", "rent"].includes(p.deal_type))
    return { ok: false, message: "模板信息不完整" };
  const id = nextId("TPL");
  db.prepare(
    `INSERT INTO contract_templates(id, company_id, name, deal_type, content, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(id, user.company_id, p.name, p.deal_type, p.content, user.id, nowIso(), nowIso());
  writeAudit(db, user, "contract.template.create", "contract_template", id, {
    name: p.name,
    deal_type: p.deal_type,
  });
  const recipients = db
    .prepare(
      `SELECT id, store_id FROM users WHERE company_id=? AND status='active'
       AND role IN ('admin', 'store_manager')`
    )
    .all(user.company_id) as any[];
  const body = `${p.name} · ${p.deal_type}`;
  for (const recipient of recipients) {
    if (recipient.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: recipient.store_id,
      user_id: recipient.id,
      title: "合同模板已创建",
      body,
      kind: "business_record_status",
      ref_type: "contract_template",
      ref_id: id,
    });
  }
  return { ok: true, data: { id } };
}

export function sign(db: Db, user: SessionUser, p: any): ApiResult {
  const deal = db.prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`).get(p.deal_id, user.company_id) as any;
  if (!deal) return { ok: false, message: "成交单不存在" };
  const agents = JSON.parse(deal.agent_ids || "[]") as string[];
  if (!(user.role === "admin" || user.role === "store_manager" || agents.includes(user.id)))
    return { ok: false, message: "无权限", code: 403 };
  if (!["pending_approval", "approved"].includes(deal.status))
    return { ok: false, message: "当前成交状态不可签署确认" };
  const statement = String(p.statement || "").trim();
  if (statement.length < 5) return { ok: false, message: "确认声明至少 5 个字" };
  const id = nextId("SIG");
  const now = nowIso();
  db.prepare(
    `INSERT INTO deal_signoffs(id, company_id, store_id, deal_id, signer_user_id,
     signer_name, statement, status, signed_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?)`
  ).run(id, user.company_id, deal.store_id, deal.id, user.id, user.display_name, statement, now, user.id, now);
  writeAudit(db, user, "deal.signoff", "deal", deal.id, { signoff_id: id });
  return { ok: true, data: { id, signed_at: now, legal_ca: false } };
}

export function signoffs(db: Db, user: SessionUser, p: any): ApiResult {
  return {
    ok: true,
    data: db
      .prepare(`SELECT * FROM deal_signoffs WHERE company_id=? AND deal_id=? ORDER BY signed_at`)
      .all(user.company_id, p.deal_id),
  };
}
