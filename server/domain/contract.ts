import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function canAccessDeal(user: SessionUser, deal: any): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  if (user.role === "store_manager") return deal.store_id === user.store_id;
  const agents = JSON.parse(deal.agent_ids || "[]") as string[];
  return deal.store_id === user.store_id && (agents.includes(user.id) || deal.created_by === user.id);
}

function buildPlaceholderMap(db: Db, deal: any): Record<string, string> {
  const house = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(deal.house_id, deal.company_id) as any;
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(deal.customer_id, deal.company_id) as any;
  const agentIds = JSON.parse(deal.agent_ids || "[]") as string[];
  const agentNames = agentIds
    .map((id) => {
      const row = db
        .prepare(`SELECT display_name FROM users WHERE id = ?`)
        .get(id) as { display_name?: string } | undefined;
      return row?.display_name || id;
    })
    .filter(Boolean);
  return {
    deal_id: deal.id,
    deal_type: deal.deal_type || "",
    deal_date: deal.deal_date || "",
    contract_price: String(deal.contract_price ?? ""),
    commission_total: String(deal.commission_total ?? ""),
    commission_owner: String(deal.commission_owner ?? ""),
    commission_customer: String(deal.commission_customer ?? ""),
    loan_amount: deal.loan_amount == null ? "" : String(deal.loan_amount),
    loan_bank: deal.loan_bank || "",
    remark: deal.remark || "",
    house_id: deal.house_id || "",
    house_title: house?.title || "",
    community: house?.community || "",
    owner: house?.owner_name || "",
    owner_name: house?.owner_name || "",
    owner_phone: house?.owner_phone || "",
    customer: customer?.name || "",
    customer_name: customer?.name || "",
    customer_phone: customer?.phone || "",
    agent: agentNames[0] || "",
    agents: agentNames.join("、"),
  };
}

function renderTemplate(content: string, values: Record<string, string>) {
  const used: string[] = [];
  const missing: string[] = [];
  const rendered = content.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_all, key: string) => {
    used.push(key);
    if (!(key in values) || values[key] === "") {
      missing.push(key);
      return "";
    }
    return values[key];
  });
  return {
    rendered,
    placeholders_used: [...new Set(used)],
    placeholders_missing: [...new Set(missing)],
  };
}

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
  writeAudit(db, user, "contract.template.save", "contract_template", id, {
    name: p.name,
    deal_type: p.deal_type,
  });
  return { ok: true, data: { id } };
}

export function preview(db: Db, user: SessionUser, p: any): ApiResult {
  if (!p.deal_id) return { ok: false, message: "成交单必填" };
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(p.deal_id, user.company_id) as any;
  if (!deal) return { ok: false, message: "成交单不存在" };
  if (!canAccessDeal(user, deal)) return { ok: false, message: "无权限", code: 403 };

  let template: any = null;
  let content = String(p.content || "");
  if (p.template_id) {
    template = db
      .prepare(
        `SELECT * FROM contract_templates WHERE id = ? AND company_id = ? AND status = 'active'`
      )
      .get(p.template_id, user.company_id) as any;
    if (!template) return { ok: false, message: "合同模板不存在" };
    content = template.content;
  } else if (!content) {
    template = db
      .prepare(
        `SELECT * FROM contract_templates
         WHERE company_id = ? AND status = 'active' AND deal_type = ?
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(user.company_id, deal.deal_type) as any;
    if (!template) return { ok: false, message: "未找到匹配的合同模板" };
    content = template.content;
  }

  const values = buildPlaceholderMap(db, deal);
  const result = renderTemplate(content, values);
  writeAudit(db, user, "contract.preview", "deal", deal.id, {
    template_id: template?.id || null,
  });
  return {
    ok: true,
    data: {
      deal_id: deal.id,
      template_id: template?.id || null,
      template_name: template?.name || null,
      content: result.rendered,
      placeholders_used: result.placeholders_used,
      placeholders_missing: result.placeholders_missing,
      legal_ca: false,
    },
  };
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
