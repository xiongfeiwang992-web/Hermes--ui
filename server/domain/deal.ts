import type { Db } from "../db/database";
import {
  canApproveDeal,
  canRegisterPayment,
  canSeeCommissions,
  canWriteListing,
} from "../auth/policy";
import { writeAudit } from "./audit";
import {
  isAllowedPaymentMethod,
  labelPaymentMethod,
  normalizePaymentMethod,
} from "./config";
import { createMessage } from "./message";
import { initForDeal, readiness } from "./dealDocuments";
import { seedNodesForDeal } from "./transfer";
import { initializeMortgage } from "./mortgage";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function presentDeal(db: Db, companyId: string, row: any) {
  const agentIds = parseJson<string[]>(row.agent_ids, []);
  const splitRatios = parseJson<Record<string, number>>(row.split_ratios, {});
  const agents = agentIds.map((id) => {
    const user = db
      .prepare(`SELECT display_name FROM users WHERE id = ? AND company_id = ?`)
      .get(id, companyId) as { display_name?: string } | undefined;
    const ratio = Number(splitRatios[id] ?? 0);
    return {
      id,
      display_name: user?.display_name || id,
      ratio,
    };
  });
  return {
    ...row,
    agent_ids: agentIds,
    split_ratios: splitRatios,
    agents,
    split_summary: agents.map((item) => `${item.display_name} ${item.ratio}%`).join(" · "),
  };
}

function normalizeDealSplit(
  db: Db,
  user: SessionUser,
  agentIdsRaw: string[] | undefined,
  splitRaw: Record<string, number> | undefined
): { ok: true; agentIds: string[]; split: Record<string, number> } | { ok: false; message: string } {
  const agentIds = agentIdsRaw?.length ? [...new Set(agentIdsRaw.map(String))] : [user.id];
  if (!agentIds.length) return { ok: false, message: "至少选择一名分成经纪人" };
  const split: Record<string, number> = { ...(splitRaw || {}) };
  if (!Object.keys(split).length) {
    const each = Math.floor((100 / agentIds.length) * 100) / 100;
    agentIds.forEach((id, idx) => {
      split[id] = idx === agentIds.length - 1 ? 100 - each * (agentIds.length - 1) : each;
    });
  }
  for (const id of agentIds) {
    const member = db
      .prepare(
        `SELECT id, store_id, role, status, display_name FROM users WHERE id = ? AND company_id = ?`
      )
      .get(id, user.company_id) as any;
    if (!member || member.status !== "active") {
      return { ok: false, message: `分成人员无效：${id}` };
    }
    if (!["agent", "store_manager", "admin"].includes(member.role)) {
      return { ok: false, message: "分成人员须为经纪人/店长/管理员" };
    }
    if (user.role !== "admin" && member.store_id !== user.store_id) {
      return { ok: false, message: "只能选择本店人员分成" };
    }
    if (split[id] == null || Number.isNaN(Number(split[id]))) {
      return { ok: false, message: `缺少分成比例：${member.display_name || id}` };
    }
  }
  for (const key of Object.keys(split)) {
    if (!agentIds.includes(key)) delete split[key];
  }
  const sum = agentIds.reduce((acc, id) => acc + Number(split[id] || 0), 0);
  if (Math.abs(sum - 100) > 0.01) return { ok: false, message: "分成比例合计须为 100%" };
  return { ok: true, agentIds, split };
}

function getAgentPoolRate(db: Db, companyId: string): number {
  const row = db
    .prepare(`SELECT agent_pool_rate FROM settings WHERE company_id = ?`)
    .get(companyId) as any;
  return row?.agent_pool_rate ?? 0.5;
}

export function createDeal(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  if (!payload.house_id || !payload.customer_id || payload.contract_price == null) {
    return { ok: false, message: "成交单信息不完整" };
  }
  const house = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.house_id, user.company_id) as any;
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.customer_id, user.company_id) as any;
  if (!house || !customer) return { ok: false, message: "房源或客源不存在" };

  const commissionOwner = Number(payload.commission_owner || 0);
  const commissionCustomer = Number(payload.commission_customer || 0);
  const commissionTotal =
    payload.commission_total != null
      ? Number(payload.commission_total)
      : commissionOwner + commissionCustomer;
  if (Math.abs(commissionOwner + commissionCustomer - commissionTotal) > 0.01) {
    return { ok: false, message: "业主佣 + 客户佣 须等于应收合计" };
  }
  const splitNorm = normalizeDealSplit(db, user, payload.agent_ids, payload.split_ratios);
  if (!splitNorm.ok) return { ok: false, message: splitNorm.message };
  const agentIds = splitNorm.agentIds;
  const split = splitNorm.split;
  const settings = db.prepare(`SELECT * FROM settings WHERE company_id = ?`).get(user.company_id) as any;
  const required = parseJson<string[]>(settings?.deal_required_fields || "[]", []);
  for (const field of required) {
    if (payload[field] == null || payload[field] === "")
      return { ok: false, message: `成交必录字段缺失：${field}` };
  }

  const id = nextId("D");
  const now = nowIso();
  db.prepare(
    `INSERT INTO deals(
      id, company_id, store_id, deal_type, house_id, customer_id, view_id,
      contract_price, commission_total, commission_owner, commission_customer, deal_date,
      status, agent_ids, split_ratios, remark, contract_attachment, loan_amount, loan_bank,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    payload.deal_type || house.deal_type,
    payload.house_id,
    payload.customer_id,
    payload.view_id || null,
    Number(payload.contract_price),
    commissionTotal,
    commissionOwner,
    commissionCustomer,
    payload.deal_date || now.slice(0, 10),
    JSON.stringify(agentIds),
    JSON.stringify(split),
    payload.remark || null,
    payload.contract_attachment || null,
    payload.loan_amount == null ? null : Number(payload.loan_amount),
    payload.loan_bank || null,
    user.id,
    now,
    now
  );
  initForDeal(db, id);
  initializeMortgage(db, id);
  writeAudit(db, user, "deal.create", "deal", id);
  return getDeal(db, user, id);
}

export function getDeal(db: Db, user: SessionUser, id: string): ApiResult {
  const row = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(id, user.company_id) as any;
  if (!row) return { ok: false, message: "成交单不存在" };
  if (user.role === "store_manager" && row.store_id !== user.store_id) {
    return { ok: false, message: "无权限", code: 403 };
  }
  if (user.role === "agent") {
    const agents = parseJson<string[]>(row.agent_ids, []);
    if (row.store_id !== user.store_id || (!agents.includes(user.id) && row.created_by !== user.id)) {
      return { ok: false, message: "无权限", code: 403 };
    }
  }
  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS s FROM payments WHERE deal_id = ? AND status = 'confirmed'`
    )
    .get(id) as { s: number };
  return {
    ok: true,
    data: {
      ...presentDeal(db, user.company_id, row),
      paid_amount: paid.s,
      unpaid_amount: row.commission_total - paid.s,
    },
  };
}

export function listDeals(db: Db, user: SessionUser, q: any = {}): ApiResult {
  let rows = db
    .prepare(`SELECT * FROM deals WHERE company_id = ? ORDER BY updated_at DESC`)
    .all(user.company_id) as any[];
  if (user.role === "store_manager") rows = rows.filter((d) => d.store_id === user.store_id);
  if (user.role === "agent") {
    rows = rows.filter((d) => {
      const agents = parseJson<string[]>(d.agent_ids, []);
      return d.store_id === user.store_id && (agents.includes(user.id) || d.created_by === user.id);
    });
  }
  if (q.status) rows = rows.filter((d) => d.status === q.status);
  return {
    ok: true,
    data: rows.map((r) => {
      const paid = db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS s FROM payments WHERE deal_id = ? AND status = 'confirmed'`
        )
        .get(r.id) as { s: number };
      return {
        ...presentDeal(db, user.company_id, r),
        paid_amount: paid.s,
        unpaid_amount: r.commission_total - paid.s,
      };
    }),
  };
}

export function submitDeal(db: Db, user: SessionUser, payload: { id: string }): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current) return { ok: false, message: "成交单不存在" };
  if (!["draft", "rejected"].includes(current.status)) {
    return { ok: false, message: "当前状态不可提交" };
  }
  const settings = db
    .prepare(`SELECT deal_doc_required FROM settings WHERE company_id=?`)
    .get(user.company_id) as any;
  if (settings?.deal_doc_required) {
    const documentStatus = readiness(db, current.id);
    if (!documentStatus.ready) {
      return {
        ok: false,
        message: `交易资料未齐：${documentStatus.missing.join("、")}`,
      };
    }
  }
  const now = nowIso();
  db.prepare(
    `UPDATE deals SET status = 'pending_approval', submitted_by = ?, submitted_at = ?, updated_at = ?, reject_reason = NULL WHERE id = ?`
  ).run(user.id, now, now, payload.id);
  db.prepare(`UPDATE houses SET status = 'deal_pending', updated_at = ? WHERE id = ?`).run(
    now,
    current.house_id
  );
  db.prepare(`UPDATE customers SET status = 'deal_pending', updated_at = ? WHERE id = ?`).run(
    now,
    current.customer_id
  );

  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id = ? AND store_id = ? AND role IN ('store_manager','admin') AND status = 'active'`
    )
    .all(user.company_id, current.store_id) as any[];
  const admins = db
    .prepare(
      `SELECT id FROM users WHERE company_id = ? AND role = 'admin' AND status = 'active'`
    )
    .all(user.company_id) as any[];
  const notifyIds = new Set([...managers, ...admins].map((u) => u.id as string));
  for (const uid of notifyIds) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: current.store_id,
      user_id: uid,
      title: "成交待审批",
      body: `成交单 ${payload.id} 待审批`,
      kind: "deal_submit",
      ref_type: "deal",
      ref_id: payload.id,
    });
  }
  writeAudit(db, user, "deal.submit", "deal", payload.id);
  return getDeal(db, user, payload.id);
}

export function approveDeal(db: Db, user: SessionUser, payload: { id: string }): ApiResult {
  if (!canApproveDeal(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current) return { ok: false, message: "成交单不存在" };
  if (user.role === "store_manager" && current.store_id !== user.store_id) {
    return { ok: false, message: "只能审批本店成交", code: 403 };
  }
  if (current.status !== "pending_approval") {
    return { ok: false, message: "当前状态不可审批" };
  }
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE deals SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?`
    ).run(user.id, now, now, payload.id);
    db.prepare(`UPDATE houses SET status = 'closed', updated_at = ? WHERE id = ?`).run(
      now,
      current.house_id
    );
    db.prepare(
      `UPDATE customers SET status = 'closed', is_confidential = 0, updated_at = ? WHERE id = ?`
    ).run(
      now,
      current.customer_id
    );

    const tier = db
      .prepare(
        `SELECT pool_rate FROM commission_tiers WHERE company_id = ? AND status = 'active'
         AND min_amount <= ? AND (max_amount IS NULL OR max_amount >= ?)
         ORDER BY min_amount DESC LIMIT 1`
      )
      .get(user.company_id, current.commission_total, current.commission_total) as any;
    const rate = tier?.pool_rate ?? getAgentPoolRate(db, user.company_id);
    const pool = current.commission_total * rate;
    const ratios = parseJson<Record<string, number>>(current.split_ratios, {});
    for (const [uid, ratio] of Object.entries(ratios)) {
      const amount = Math.round(((pool * Number(ratio)) / 100) * 100) / 100;
      db.prepare(
        `INSERT INTO commissions(id, company_id, store_id, deal_id, user_id, ratio, amount, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'accrued', ?, ?)`
      ).run(
        nextId("CM"),
        user.company_id,
        current.store_id,
        payload.id,
        uid,
        Number(ratio),
        amount,
        now,
        now
      );
      createMessage(db, {
        company_id: user.company_id,
        store_id: current.store_id,
        user_id: uid,
        title: "成交已审批",
        body: `成交单 ${payload.id} 已通过，提成应计 ¥${amount}`,
        kind: "deal_approve",
        ref_type: "deal",
        ref_id: payload.id,
      });
    }
    const settings = db.prepare(`SELECT manager_award_rate FROM settings WHERE company_id = ?`).get(
      user.company_id
    ) as any;
    const awardRate = Number(settings?.manager_award_rate || 0);
    if (awardRate > 0) {
      const manager = db
        .prepare(
          `SELECT id FROM users WHERE company_id = ? AND store_id = ?
           AND role = 'store_manager' AND status = 'active' LIMIT 1`
        )
        .get(user.company_id, current.store_id) as any;
      if (manager) {
        db.prepare(
          `INSERT INTO commissions(id, company_id, store_id, deal_id, user_id, ratio, amount, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'accrued', ?, ?)`
        ).run(
          nextId("CM"),
          user.company_id,
          current.store_id,
          payload.id,
          manager.id,
          awardRate * 100,
          Math.round(current.commission_total * awardRate * 100) / 100,
          now,
          now
        );
      }
    }
    seedNodesForDeal(db, current.id);
  });
  tx();
  writeAudit(db, user, "deal.approve", "deal", payload.id);
  return getDeal(db, user, payload.id);
}

export function rejectDeal(
  db: Db,
  user: SessionUser,
  payload: { id: string; reason: string }
): ApiResult {
  if (!canApproveDeal(user)) return { ok: false, message: "无权限", code: 403 };
  if (!payload.reason?.trim()) return { ok: false, message: "驳回原因必填" };
  const current = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current) return { ok: false, message: "成交单不存在" };
  if (user.role === "store_manager" && current.store_id !== user.store_id) {
    return { ok: false, message: "只能审批本店成交", code: 403 };
  }
  if (current.status !== "pending_approval") {
    return { ok: false, message: "当前状态不可驳回" };
  }
  const now = nowIso();
  db.prepare(
    `UPDATE deals SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?`
  ).run(payload.reason.trim(), now, payload.id);
  db.prepare(`UPDATE houses SET status = 'available', updated_at = ? WHERE id = ?`).run(
    now,
    current.house_id
  );
  db.prepare(`UPDATE customers SET status = 'viewing', updated_at = ? WHERE id = ?`).run(
    now,
    current.customer_id
  );
  if (current.submitted_by) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: current.store_id,
      user_id: current.submitted_by,
      title: "成交已驳回",
      body: `成交单 ${payload.id} 被驳回：${payload.reason}`,
      kind: "deal_reject",
      ref_type: "deal",
      ref_id: payload.id,
    });
  }
  writeAudit(db, user, "deal.reject", "deal", payload.id, { reason: payload.reason });
  return getDeal(db, user, payload.id);
}

export function createPayment(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canRegisterPayment(user)) return { ok: false, message: "无权限", code: 403 };
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(payload.deal_id, user.company_id) as any;
  if (!deal) return { ok: false, message: "成交单不存在" };
  if (deal.status !== "approved") return { ok: false, message: "仅已审批成交可收款" };
  const amount = Number(payload.amount);
  if (!(amount > 0)) return { ok: false, message: "收款金额须大于 0" };
  const method = normalizePaymentMethod(payload.method);
  if (!isAllowedPaymentMethod(db, user.company_id, method)) {
    return { ok: false, message: "收款方式不在当前字典中" };
  }
  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS s FROM payments WHERE deal_id = ? AND status = 'confirmed'`
    )
    .get(deal.id) as { s: number };
  const pending = db
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS s FROM payments
       WHERE deal_id = ? AND status = 'pending' AND direction = 'in'`
    )
    .get(deal.id) as { s: number };
  const warning = paid.s + pending.s + amount > deal.commission_total;
  const id = nextId("PAY");
  db.prepare(
    `INSERT INTO payments(
      id, company_id, store_id, deal_id, amount, pay_type, method, paid_at, payer_side,
      status, remark, created_by, created_at, direction, confirmation_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'in', 'pending')`
  ).run(
    id,
    user.company_id,
    deal.store_id,
    deal.id,
    amount,
    payload.pay_type || "commission",
    method,
    payload.paid_at || nowIso(),
    payload.payer_side || "customer",
    payload.remark || null,
    user.id,
    nowIso()
  );
  writeAudit(db, user, "payment.create", "payment", id, {
    deal_id: deal.id,
    amount,
    status: "pending",
  });
  return {
    ok: true,
    data: {
      id,
      status: "pending",
      warning: warning ? "登记后合计（含待确认）将超过应收佣金" : null,
    },
  };
}

export function confirmPayment(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canRegisterPayment(user)) return { ok: false, message: "无权限", code: 403 };
  const payment = db
    .prepare(`SELECT * FROM payments WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!payment) return { ok: false, message: "收款不存在" };
  if (payment.direction === "out") return { ok: false, message: "退款无需出纳确认" };
  if (payment.status !== "pending") return { ok: false, message: "仅待确认收款可确认到账" };
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(payment.deal_id, user.company_id) as any;
  if (!deal) return { ok: false, message: "成交单不存在" };
  const now = nowIso();
  db.prepare(
    `UPDATE payments
     SET status='confirmed', confirmation_status='confirmed',
         confirmed_by=?, confirmed_at=?, reject_reason=NULL
     WHERE id=? AND company_id=?`
  ).run(user.id, now, payment.id, user.company_id);
  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS s
       FROM payments WHERE deal_id = ? AND status = 'confirmed'`
    )
    .get(deal.id) as { s: number };
  const warning = paid.s > deal.commission_total;
  writeAudit(db, user, "payment.confirm", "payment", payment.id, {
    deal_id: deal.id,
    amount: payment.amount,
  });
  for (const uid of parseJson<string[]>(deal.agent_ids, [])) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: deal.store_id,
      user_id: uid,
      title: "佣金已到账",
      body: `成交单 ${deal.id} 收款 ¥${payment.amount} 已出纳确认${warning ? "（已超应收，已记录）" : ""}`,
      kind: "payment",
      ref_type: "deal",
      ref_id: deal.id,
    });
  }
  return {
    ok: true,
    data: {
      id: payment.id,
      status: "confirmed",
      warning: warning ? "收款合计已超过应收佣金" : null,
    },
  };
}

export function rejectPayment(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canRegisterPayment(user)) return { ok: false, message: "无权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "驳回须填写原因（至少 2 个字）" };
  const payment = db
    .prepare(`SELECT * FROM payments WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!payment) return { ok: false, message: "收款不存在" };
  if (payment.direction === "out") return { ok: false, message: "退款不可驳回确认" };
  if (payment.status !== "pending") return { ok: false, message: "仅待确认收款可驳回" };
  const now = nowIso();
  db.prepare(
    `UPDATE payments
     SET status='rejected', confirmation_status='rejected',
         confirmed_by=?, confirmed_at=?, reject_reason=?
     WHERE id=? AND company_id=?`
  ).run(user.id, now, reason, payment.id, user.company_id);
  writeAudit(db, user, "payment.reject", "payment", payment.id, {
    deal_id: payment.deal_id,
    amount: payment.amount,
    reason,
  });
  if (payment.created_by && payment.created_by !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: payment.store_id,
      user_id: payment.created_by,
      title: "收款确认被驳回",
      body: `成交单 ${payment.deal_id} 收款 ¥${payment.amount} 被驳回：${reason}`,
      kind: "payment_reject",
      ref_type: "payment",
      ref_id: payment.id,
    });
  }
  return { ok: true, data: { id: payment.id, status: "rejected" } };
}

export function listPayments(db: Db, user: SessionUser, q: any = {}): ApiResult {
  let rows = db
    .prepare(`SELECT * FROM payments WHERE company_id = ? ORDER BY paid_at DESC`)
    .all(user.company_id) as any[];
  if (user.role === "store_manager") rows = rows.filter((p) => p.store_id === user.store_id);
  if (user.role === "agent") {
    const myDeals = new Set(
      (db.prepare(`SELECT id, agent_ids, created_by, store_id FROM deals WHERE company_id = ?`).all(user.company_id) as any[])
        .filter((d) => {
          const agents = parseJson<string[]>(d.agent_ids, []);
          return d.store_id === user.store_id && (agents.includes(user.id) || d.created_by === user.id);
        })
        .map((d) => d.id)
    );
    rows = rows.filter((p) => myDeals.has(p.deal_id));
  }
  if (q.deal_id) rows = rows.filter((p) => p.deal_id === q.deal_id);
  if (q.status) rows = rows.filter((p) => p.status === q.status);
  if (q.method) {
    const method = normalizePaymentMethod(q.method);
    rows = rows.filter((p) => normalizePaymentMethod(p.method) === method);
  }
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      method_label: labelPaymentMethod(db, user.company_id, row.method),
    })),
  };
}

export function createRefund(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canRegisterPayment(user)) return { ok: false, message: "无权限", code: 403 };
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(payload.deal_id, user.company_id) as any;
  const amount = Number(payload.amount);
  if (!deal || !(amount > 0) || !String(payload.reason || "").trim())
    return { ok: false, message: "退款须指定成交、正金额和原因" };
  const method = normalizePaymentMethod(payload.method);
  if (!isAllowedPaymentMethod(db, user.company_id, method)) {
    return { ok: false, message: "收款方式不在当前字典中" };
  }
  const paid = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS s
       FROM payments WHERE deal_id=? AND status='confirmed'`
    )
    .get(deal.id) as any;
  if (amount > Number(paid.s)) return { ok: false, message: "退款不得超过净已收" };
  const id = nextId("PAY");
  db.prepare(
    `INSERT INTO payments(id, company_id, store_id, deal_id, amount, pay_type, method,
     paid_at, payer_side, status, remark, created_by, created_at, direction, confirmation_status)
     VALUES (?, ?, ?, ?, ?, 'refund', ?, ?, ?, 'confirmed', ?, ?, ?, 'out', 'confirmed')`
  ).run(
    id,
    user.company_id,
    deal.store_id,
    deal.id,
    amount,
    method,
    payload.paid_at || nowIso(),
    payload.payer_side || "customer",
    payload.reason,
    user.id,
    nowIso()
  );
  writeAudit(db, user, "payment.refund", "payment", id, { deal_id: deal.id, amount });
  return { ok: true, data: { id } };
}

export function listCommissions(db: Db, user: SessionUser): ApiResult {
  const scope = canSeeCommissions(user);
  if (scope === "none") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(`SELECT * FROM commissions WHERE company_id = ? ORDER BY created_at DESC`)
    .all(user.company_id) as any[];
  if (scope === "store") rows = rows.filter((c) => c.store_id === user.store_id);
  if (scope === "self") rows = rows.filter((c) => c.user_id === user.id);
  return { ok: true, data: rows };
}

export function markCommissionPaid(
  db: Db,
  user: SessionUser,
  payload: { id: string }
): ApiResult {
  if (!(user.role === "admin" || user.role === "finance")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  db.prepare(
    `UPDATE commissions SET status = 'paid', updated_at = ? WHERE id = ? AND company_id = ?`
  ).run(nowIso(), payload.id, user.company_id);
  writeAudit(db, user, "commission.paid", "commission", payload.id);
  return { ok: true, data: { id: payload.id } };
}
