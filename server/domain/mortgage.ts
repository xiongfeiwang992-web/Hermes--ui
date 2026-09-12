import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const TRANSITIONS: Record<string, string[]> = {
  draft: ["applied", "cancelled"],
  applied: ["approved", "rejected", "cancelled"],
  rejected: ["applied", "cancelled"],
  approved: ["disbursed", "cancelled"],
  disbursed: [],
  cancelled: [],
};

function visible(user: SessionUser, deal: any): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  if (deal.store_id !== user.store_id) return false;
  if (user.role === "store_manager") return true;
  return (
    deal.created_by === user.id ||
    (JSON.parse(deal.agent_ids || "[]") as string[]).includes(user.id)
  );
}

export function initializeMortgage(db: Db, dealId: string): string | null {
  const deal = db.prepare(`SELECT * FROM deals WHERE id=?`).get(dealId) as any;
  if (!deal || !(Number(deal.loan_amount) > 0) || !deal.loan_bank) return null;
  const existing = db
    .prepare(`SELECT id FROM deal_mortgages WHERE deal_id=?`)
    .get(deal.id) as any;
  if (existing) return existing.id;
  const id = nextId("MTG");
  const now = nowIso();
  db.prepare(
    `INSERT INTO deal_mortgages(
       id, company_id, store_id, deal_id, bank, amount, status,
       created_by, updated_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(
    id,
    deal.company_id,
    deal.store_id,
    deal.id,
    deal.loan_bank,
    Number(deal.loan_amount),
    deal.created_by,
    deal.created_by,
    now,
    now
  );
  return id;
}

export function getMortgage(db: Db, user: SessionUser, payload: any): ApiResult {
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`)
    .get(payload.deal_id, user.company_id) as any;
  if (!deal || !visible(user, deal))
    return { ok: false, message: "成交单不存在或无权限", code: 403 };
  initializeMortgage(db, deal.id);
  const row = db.prepare(`SELECT * FROM deal_mortgages WHERE deal_id=?`).get(deal.id);
  return { ok: true, data: row || null };
}

export function upsertMortgage(db: Db, user: SessionUser, payload: any): ApiResult {
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`)
    .get(payload.deal_id, user.company_id) as any;
  if (!deal || !visible(user, deal))
    return { ok: false, message: "成交单不存在或无权限", code: 403 };
  const amount = Number(payload.amount);
  const bank = String(payload.bank || "").trim();
  if (!(amount > 0) || amount > Number(deal.contract_price) || !bank)
    return { ok: false, message: "贷款银行或金额无效，金额不得超过成交价" };
  const current = db
    .prepare(`SELECT * FROM deal_mortgages WHERE deal_id=?`)
    .get(deal.id) as any;
  if (current && !["draft", "rejected"].includes(current.status))
    return { ok: false, message: "当前按揭状态不可修改" };
  const now = nowIso();
  if (current) {
    db.prepare(
      `UPDATE deal_mortgages SET bank=?, amount=?, remark=?, updated_by=?, updated_at=?
       WHERE id=?`
    ).run(bank, amount, payload.remark || null, user.id, now, current.id);
    db.prepare(`UPDATE deals SET loan_bank=?, loan_amount=?, updated_at=? WHERE id=?`).run(
      bank,
      amount,
      now,
      deal.id
    );
    writeAudit(db, user, "mortgage.update", "mortgage", current.id);
    return getMortgage(db, user, { deal_id: deal.id });
  }
  const id = nextId("MTG");
  db.prepare(
    `INSERT INTO deal_mortgages(
       id, company_id, store_id, deal_id, bank, amount, status, remark,
       created_by, updated_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    deal.store_id,
    deal.id,
    bank,
    amount,
    payload.remark || null,
    user.id,
    user.id,
    now,
    now
  );
  db.prepare(`UPDATE deals SET loan_bank=?, loan_amount=?, updated_at=? WHERE id=?`).run(
    bank,
    amount,
    now,
    deal.id
  );
  writeAudit(db, user, "mortgage.create", "mortgage", id);
  const recipients = new Set<string>([
    deal.created_by,
    ...(JSON.parse(deal.agent_ids || "[]") as string[]),
  ]);
  for (const userId of recipients) {
    if (!userId || userId === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: deal.store_id,
      user_id: userId,
      title: "按揭记录已登记",
      body: `${bank} · ${amount}`,
      kind: "mortgage_status",
      ref_type: "deal",
      ref_id: deal.id,
    });
  }
  return getMortgage(db, user, { deal_id: deal.id });
}

export function changeMortgageStatus(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  const mortgage = db
    .prepare(
      `SELECT m.*, d.agent_ids, d.created_by AS deal_created_by
       FROM deal_mortgages m JOIN deals d ON d.id=m.deal_id
       WHERE m.deal_id=? AND m.company_id=?`
    )
    .get(payload.deal_id, user.company_id) as any;
  if (!mortgage || !visible(user, { ...mortgage, created_by: mortgage.deal_created_by }))
    return { ok: false, message: "按揭记录不存在或无权限", code: 403 };
  if (!(TRANSITIONS[mortgage.status] || []).includes(payload.status))
    return { ok: false, message: `不能从 ${mortgage.status} 变更为 ${payload.status}` };
  if (
    ["approved", "rejected"].includes(payload.status) &&
    !(user.role === "admin" || user.role === "finance" || user.role === "store_manager")
  )
    return { ok: false, message: "无按揭审批权限", code: 403 };
  if (payload.status === "disbursed" && !(user.role === "admin" || user.role === "finance"))
    return { ok: false, message: "仅管理员或财务可确认放款", code: 403 };
  if (
    ["rejected", "cancelled"].includes(payload.status) &&
    !String(payload.reason || "").trim()
  )
    return { ok: false, message: "驳回或取消原因必填" };
  const now = nowIso();
  db.prepare(
    `UPDATE deal_mortgages SET status=?, applied_at=CASE WHEN ?='applied' THEN ? ELSE applied_at END,
     approved_at=CASE WHEN ?='approved' THEN ? ELSE approved_at END,
     rejected_at=CASE WHEN ?='rejected' THEN ? ELSE rejected_at END,
     reject_reason=CASE WHEN ?='rejected' THEN ? ELSE reject_reason END,
     disbursed_at=CASE WHEN ?='disbursed' THEN ? ELSE disbursed_at END,
     cancelled_at=CASE WHEN ?='cancelled' THEN ? ELSE cancelled_at END,
     cancel_reason=CASE WHEN ?='cancelled' THEN ? ELSE cancel_reason END,
     updated_by=?, updated_at=? WHERE id=?`
  ).run(
    payload.status,
    payload.status,
    now,
    payload.status,
    now,
    payload.status,
    now,
    payload.status,
    payload.reason || null,
    payload.status,
    now,
    payload.status,
    now,
    payload.status,
    payload.reason || null,
    user.id,
    now,
    mortgage.id
  );
  const recipients = new Set<string>([
    mortgage.deal_created_by,
    ...(JSON.parse(mortgage.agent_ids || "[]") as string[]),
  ]);
  for (const userId of recipients) {
    if (userId === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: mortgage.store_id,
      user_id: userId,
      title: "按揭状态更新",
      body: `${mortgage.bank}：${mortgage.status} → ${payload.status}`,
      kind: "mortgage_status",
      ref_type: "deal",
      ref_id: mortgage.deal_id,
    });
  }
  writeAudit(db, user, "mortgage.status", "mortgage", mortgage.id, {
    from: mortgage.status,
    to: payload.status,
    reason: payload.reason,
  });
  return getMortgage(db, user, { deal_id: mortgage.deal_id });
}

export function canCompleteLoanNode(db: Db, dealId: string): boolean {
  const row = db
    .prepare(`SELECT status FROM deal_mortgages WHERE deal_id=?`)
    .get(dealId) as any;
  return !row || ["approved", "disbursed"].includes(row.status);
}

export function markMortgageDisbursed(db: Db, dealId: string, userId: string): void {
  const now = nowIso();
  db.prepare(
    `UPDATE deal_mortgages SET status='disbursed', disbursed_at=COALESCE(disbursed_at, ?),
     updated_by=?, updated_at=? WHERE deal_id=? AND status='approved'`
  ).run(now, userId, now, dealId);
}
