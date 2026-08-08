import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const TRANSITIONS: Record<string, string[]> = {
  pending: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

function dealVisibleTo(user: SessionUser, deal: any): boolean {
  if (user.role === "admin" || user.role === "finance") return true;
  if (deal.store_id !== user.store_id) return false;
  if (user.role === "store_manager") return true;
  const agents = JSON.parse(deal.agent_ids || "[]") as string[];
  return agents.includes(user.id) || deal.created_by === user.id;
}

export function listTransferNodes(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT n.*, d.status AS deal_status, u.display_name AS assignee_name
       FROM transfer_nodes n
       JOIN deals d ON d.id = n.deal_id
       LEFT JOIN users u ON u.id = n.assignee_user_id
       WHERE n.company_id = ?
       ORDER BY COALESCE(n.planned_at, n.created_at), n.created_at`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    const deal = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(row.deal_id) as any;
    return deal && dealVisibleTo(user, deal);
  });
  if (payload.deal_id) rows = rows.filter((row) => row.deal_id === payload.deal_id);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function createTransferNode(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager")) {
    return { ok: false, message: "仅管理员或店长可创建过户节点", code: 403 };
  }
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id = ? AND company_id = ?`)
    .get(payload.deal_id, user.company_id) as any;
  if (!deal || !dealVisibleTo(user, deal)) {
    return { ok: false, message: "成交单不存在或无权限", code: 403 };
  }
  if (deal.status !== "approved") {
    return { ok: false, message: "仅已审批成交可创建过户节点" };
  }
  const title = String(payload.title || "").trim();
  if (!title) return { ok: false, message: "节点名称必填" };
  const nodeType = String(payload.node_type || "other");
  const id = nextId("TRN");
  const now = nowIso();
  db.prepare(
    `INSERT INTO transfer_nodes(
      id, company_id, store_id, deal_id, node_type, title, status,
      planned_at, assignee_user_id, remark, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    deal.store_id,
    deal.id,
    nodeType,
    title,
    payload.planned_at || null,
    payload.assignee_user_id || null,
    payload.remark || null,
    user.id,
    now,
    now
  );
  if (payload.assignee_user_id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: deal.store_id,
      user_id: payload.assignee_user_id,
      title: "新增交易办理节点",
      body: `${title}${payload.planned_at ? `，计划 ${payload.planned_at}` : ""}`,
      kind: "transfer_node",
      ref_type: "deal",
      ref_id: deal.id,
    });
  }
  writeAudit(db, user, "transfer_node.create", "transfer_node", id, {
    deal_id: deal.id,
    title,
  });
  return { ok: true, data: { id } };
}

export function changeTransferStatus(db: Db, user: SessionUser, payload: any): ApiResult {
  const node = db
    .prepare(
      `SELECT n.*, d.agent_ids, d.created_by AS deal_created_by
       FROM transfer_nodes n JOIN deals d ON d.id = n.deal_id
       WHERE n.id = ? AND n.company_id = ?`
    )
    .get(payload.id, user.company_id) as any;
  if (!node) return { ok: false, message: "过户节点不存在" };
  const canManage =
    user.role === "admin" ||
    (user.role === "store_manager" && user.store_id === node.store_id) ||
    (user.role === "agent" &&
      user.store_id === node.store_id &&
      (node.assignee_user_id === user.id ||
        (JSON.parse(node.agent_ids || "[]") as string[]).includes(user.id)));
  if (!canManage) return { ok: false, message: "无权限", code: 403 };
  if (!(TRANSITIONS[node.status] || []).includes(payload.status)) {
    return { ok: false, message: `不能从 ${node.status} 变更为 ${payload.status}` };
  }
  if (payload.status === "cancelled" && !String(payload.reason || "").trim()) {
    return { ok: false, message: "取消原因必填" };
  }
  const now = nowIso();
  db.prepare(
    `UPDATE transfer_nodes SET status = ?, completed_at = ?,
     remark = CASE WHEN ? IS NULL THEN remark ELSE ? END, updated_at = ?
     WHERE id = ?`
  ).run(
    payload.status,
    payload.status === "completed" ? now : null,
    payload.reason || null,
    payload.reason || null,
    now,
    node.id
  );
  writeAudit(db, user, "transfer_node.status", "transfer_node", node.id, {
    from: node.status,
    to: payload.status,
    reason: payload.reason,
  });
  return { ok: true, data: { id: node.id, status: payload.status } };
}

export function listTransferTemplates(
  db: Db,
  user: SessionUser,
  payload: any = {}
): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT * FROM transfer_templates
       WHERE company_id=? AND status='active' ORDER BY deal_type, sort_order`
    )
    .all(user.company_id) as any[];
  if (payload.deal_type) rows = rows.filter((row) => row.deal_type === payload.deal_type);
  return { ok: true, data: rows };
}

export function saveTransferTemplate(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const roles = ["admin", "store_manager", "agent", "finance", ""];
  if (
    !["sale", "rent"].includes(payload.deal_type) ||
    !payload.node_type ||
    !payload.title ||
    !roles.includes(payload.default_assignee_role || "")
  )
    return { ok: false, message: "过户模板信息无效" };
  const current = db
    .prepare(
      `SELECT id FROM transfer_templates
       WHERE company_id=? AND deal_type=? AND node_type=?`
    )
    .get(user.company_id, payload.deal_type, payload.node_type) as any;
  const id = current?.id || nextId("TRT");
  const now = nowIso();
  db.prepare(
    `INSERT INTO transfer_templates(
       id, company_id, deal_type, node_type, title, sort_order,
       default_assignee_role, status, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
     ON CONFLICT(company_id, deal_type, node_type) DO UPDATE SET
       title=excluded.title, sort_order=excluded.sort_order,
       default_assignee_role=excluded.default_assignee_role,
       status='active', updated_at=excluded.updated_at`
  ).run(
    id,
    user.company_id,
    payload.deal_type,
    payload.node_type,
    payload.title,
    Number(payload.sort_order || 0),
    payload.default_assignee_role || null,
    user.id,
    now,
    now
  );
  writeAudit(db, user, "transfer_template.save", "transfer_template", id, payload);
  return { ok: true, data: { id } };
}

function defaultAssignee(db: Db, deal: any, role: string | null): string | null {
  if (!role) return null;
  if (role === "agent") {
    return (JSON.parse(deal.agent_ids || "[]") as string[])[0] || deal.created_by;
  }
  const row = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND role=? AND status='active'
       AND (?='finance' OR store_id=?) ORDER BY created_at LIMIT 1`
    )
    .get(deal.company_id, role, role, deal.store_id) as any;
  return row?.id || null;
}

export function seedNodesForDeal(db: Db, dealId: string): number {
  const deal = db.prepare(`SELECT * FROM deals WHERE id=?`).get(dealId) as any;
  if (!deal) return 0;
  const templates = db
    .prepare(
      `SELECT * FROM transfer_templates
       WHERE company_id=? AND deal_type=? AND status='active' ORDER BY sort_order`
    )
    .all(deal.company_id, deal.deal_type) as any[];
  let created = 0;
  const now = nowIso();
  for (const template of templates) {
    const exists = db
      .prepare(`SELECT id FROM transfer_nodes WHERE deal_id=? AND node_type=?`)
      .get(deal.id, template.node_type);
    if (exists) continue;
    const id = nextId("TRN");
    const assignee = defaultAssignee(db, deal, template.default_assignee_role);
    db.prepare(
      `INSERT INTO transfer_nodes(
         id, company_id, store_id, deal_id, node_type, title, status,
         assignee_user_id, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
    ).run(
      id,
      deal.company_id,
      deal.store_id,
      deal.id,
      template.node_type,
      template.title,
      assignee,
      deal.created_by,
      now,
      now
    );
    if (assignee) {
      createMessage(db, {
        company_id: deal.company_id,
        store_id: deal.store_id,
        user_id: assignee,
        title: "新增交易办理节点",
        body: `${template.title}（成交单 ${deal.id}）`,
        kind: "transfer_node",
        ref_type: "deal",
        ref_id: deal.id,
      });
    }
    created++;
  }
  return created;
}

export function seedTransferNodes(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无权限", code: 403 };
  const deal = db
    .prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`)
    .get(payload.deal_id, user.company_id) as any;
  if (
    !deal ||
    deal.status !== "approved" ||
    (user.role === "store_manager" && deal.store_id !== user.store_id)
  )
    return { ok: false, message: "成交单不存在、未审批或无权限" };
  const created = seedNodesForDeal(db, deal.id);
  writeAudit(db, user, "transfer.seed", "deal", deal.id, { created });
  return { ok: true, data: { created } };
}
