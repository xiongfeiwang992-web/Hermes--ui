import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { markReceived } from "./dealDocuments";
import { linkEntrustmentAttachment } from "./entrustment";
import { houseVisibleTo } from "../auth/policy";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

export function listAttachments(db: Db, user: SessionUser, payload: any): ApiResult {
  if (payload.parent_type === "expense_request") {
    const expense = db
      .prepare(`SELECT * FROM expense_requests WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !expense ||
      !(
        user.role === "admin" ||
        user.role === "finance" ||
        (user.role === "store_manager" && expense.store_id === user.store_id) ||
        expense.applicant_user_id === user.id
      )
    )
      return { ok: false, message: "报销单不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "cashbook_entry") {
    const entry = db
      .prepare(`SELECT * FROM cashbook_entries WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !entry ||
      !(
        user.role === "admin" ||
        user.role === "finance" ||
        (user.role === "store_manager" && entry.store_id === user.store_id)
      )
    )
      return { ok: false, message: "收支记录不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "recruitment_candidate") {
    const candidate = db
      .prepare(`SELECT * FROM recruitment_candidates WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !candidate ||
      !(
        user.role === "admin" ||
        (user.role === "store_manager" && candidate.store_id === user.store_id)
      )
    )
      return { ok: false, message: "候选人不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "employee_contract") {
    const contract = db
      .prepare(`SELECT * FROM employee_contracts WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !contract ||
      !(
        user.role === "admin" ||
        (user.role === "store_manager" && contract.store_id === user.store_id) ||
        contract.user_id === user.id
      )
    )
      return { ok: false, message: "员工合同不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "office_document") {
    const document = db
      .prepare(`SELECT * FROM office_documents WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canManage =
      document &&
      (user.role === "admin" ||
        (user.role === "store_manager" &&
          document.scope_type === "store" &&
          document.store_id === user.store_id));
    const canRead =
      document &&
      document.status === "published" &&
      (document.scope_type === "company" || document.store_id === user.store_id);
    if (!canManage && !canRead)
      return { ok: false, message: "文档不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "rental_property") {
    const property = db
      .prepare(`SELECT * FROM rental_properties WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !property ||
      !(
        user.role === "admin" ||
        user.role === "finance" ||
        (user.role === "store_manager" && property.store_id === user.store_id) ||
        property.manager_user_id === user.id
      )
    )
      return { ok: false, message: "托管物业不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "rental_lease") {
    const lease = db
      .prepare(
        `SELECT l.*, p.manager_user_id FROM rental_leases l
         JOIN rental_properties p ON p.id=l.property_id
         WHERE l.id=? AND l.company_id=?`
      )
      .get(payload.parent_id, user.company_id) as any;
    if (
      !lease ||
      !(
        user.role === "admin" ||
        user.role === "finance" ||
        (user.role === "store_manager" && lease.store_id === user.store_id) ||
        lease.manager_user_id === user.id
      )
    )
      return { ok: false, message: "租约不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "rental_work_order") {
    const workOrder = db
      .prepare(
        `SELECT w.*, p.manager_user_id FROM rental_work_orders w
         JOIN rental_properties p ON p.id=w.property_id
         WHERE w.id=? AND w.company_id=?`
      )
      .get(payload.parent_id, user.company_id) as any;
    if (
      !workOrder ||
      !(
        user.role === "admin" ||
        user.role === "finance" ||
        (user.role === "store_manager" && workOrder.store_id === user.store_id) ||
        workOrder.manager_user_id === user.id ||
        workOrder.assignee_user_id === user.id
      )
    )
      return { ok: false, message: "租赁工单不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "customer_care_case") {
    const careCase = db
      .prepare(`SELECT * FROM customer_care_cases WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !careCase ||
      user.role === "finance" ||
      !(
        user.role === "admin" ||
        (user.role === "store_manager" && careCase.store_id === user.store_id) ||
        careCase.created_by === user.id ||
        careCase.assignee_user_id === user.id
      )
    )
      return { ok: false, message: "客户关怀案件不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "newhome_sales_report") {
    const report = db
      .prepare(`SELECT * FROM newhome_sales_reports WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !report ||
      !(
        user.role === "admin" ||
        user.role === "finance" ||
        (user.role === "store_manager" && report.store_id === user.store_id) ||
        report.agent_id === user.id ||
        report.created_by === user.id
      )
    )
      return { ok: false, message: "销售报告不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "deal_complaint") {
    const complaint = db
      .prepare(`SELECT * FROM deal_complaints WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !complaint ||
      !(
        user.role === "admin" ||
        user.role === "finance" ||
        (user.role === "store_manager" && complaint.store_id === user.store_id) ||
        complaint.created_by === user.id ||
        complaint.assignee_user_id === user.id
      )
    )
      return { ok: false, message: "成交投诉不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "deal_rename") {
    const rename = db
      .prepare(`SELECT * FROM deal_renames WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !rename ||
      user.role === "finance" ||
      !(
        user.role === "admin" ||
        (user.role === "store_manager" && rename.store_id === user.store_id) ||
        rename.created_by === user.id
      )
    )
      return { ok: false, message: "成交更名不存在或无附件权限", code: 403 };
  }
  const rows = db
    .prepare(
      `SELECT * FROM file_attachments
       WHERE company_id = ? AND parent_type = ? AND parent_id = ?
         AND deleted_at IS NULL
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

function canDeleteAttachment(db: Db, user: SessionUser, row: any): boolean {
  if (user.role === "admin") return true;
  if (row.parent_type === "house") {
    const house = db
      .prepare(`SELECT * FROM houses WHERE id=? AND company_id=?`)
      .get(row.parent_id, user.company_id) as any;
    if (!house || !houseVisibleTo(user, house)) return false;
    if (user.role === "store_manager" && house.store_id === user.store_id) return true;
    return user.role === "agent" && house.agent_id === user.id;
  }
  if (user.role === "finance") return false;
  if (user.role === "store_manager" && row.store_id === user.store_id) return true;
  return row.created_by === user.id;
}

export function deleteAttachment(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!payload.id) return { ok: false, message: "缺少附件 id" };
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "删除须填写原因（至少 2 个字）" };
  const row = db
    .prepare(`SELECT * FROM file_attachments WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.deleted_at) return { ok: false, message: "附件不存在", code: 404 };
  if (!canDeleteAttachment(db, user, row)) {
    return { ok: false, message: "无权限删除该附件", code: 403 };
  }
  const linkedEntrustment = db
    .prepare(
      `SELECT id FROM house_entrustments
       WHERE attachment_id=? AND company_id=? AND status='active'`
    )
    .get(payload.id, user.company_id) as any;
  if (linkedEntrustment) {
    return { ok: false, message: "附件已关联生效委托，请先终止委托后再删" };
  }
  const now = nowIso();
  db.prepare(
    `UPDATE file_attachments
     SET deleted_at=?, deleted_by=?, delete_reason=?
     WHERE id=? AND company_id=?`
  ).run(now, user.id, reason, payload.id, user.company_id);
  if (row.parent_type === "house") {
    db.prepare(
      `UPDATE houses SET cover_image=NULL, updated_at=?
       WHERE id=? AND company_id=? AND cover_image=?`
    ).run(now, row.parent_id, user.company_id, row.local_path);
  }
  writeAudit(db, user, "attachment.delete", "attachment", payload.id, {
    parent_type: row.parent_type,
    parent_id: row.parent_id,
    category: row.category,
    name: row.name,
    reason,
  });
  const recipientIds = new Set<string>();
  let notifyStoreId = row.store_id;
  let body = `${row.name} · ${reason}`;
  if (row.parent_type === "house") {
    const house = db
      .prepare(`SELECT id, title, agent_id, store_id FROM houses WHERE id=? AND company_id=?`)
      .get(row.parent_id, user.company_id) as any;
    if (house?.agent_id) recipientIds.add(house.agent_id);
    notifyStoreId = house?.store_id || row.store_id;
    body = `${house?.title || row.parent_id} · ${row.name} · ${reason}`;
  } else if (row.parent_type === "deal") {
    const deal = db
      .prepare(`SELECT id, created_by, agent_ids, store_id FROM deals WHERE id=? AND company_id=?`)
      .get(row.parent_id, user.company_id) as any;
    if (deal?.created_by) recipientIds.add(deal.created_by);
    for (const agentId of JSON.parse(deal?.agent_ids || "[]") as string[]) {
      recipientIds.add(agentId);
    }
    notifyStoreId = deal?.store_id || row.store_id;
    body = `成交单 ${row.parent_id} · ${row.name} · ${reason}`;
  }
  recipientIds.delete(user.id);
  for (const recipientId of recipientIds) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: notifyStoreId,
      user_id: recipientId,
      title: "附件已删除",
      body,
      kind: "business_record_status",
      ref_type: "attachment",
      ref_id: payload.id,
    });
  }
  return { ok: true, data: { id: payload.id } };
}

export function addAttachment(db: Db, user: SessionUser, payload: any): ApiResult {
  const localPath = path.resolve(String(payload.local_path || ""));
  if (!payload.parent_type || !payload.parent_id || !payload.category || !payload.name) {
    return { ok: false, message: "附件信息不完整" };
  }
  if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
    return { ok: false, message: "本地文件不存在" };
  }
  let attachmentStoreId = user.store_id;
  if (payload.parent_type === "deal") {
    const deal = db
      .prepare(`SELECT * FROM deals WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const agents = deal ? (JSON.parse(deal.agent_ids || "[]") as string[]) : [];
    if (
      !deal ||
      !(
        user.role === "admin" ||
        user.role === "finance" ||
        (user.role === "store_manager" && deal.store_id === user.store_id) ||
        (deal.store_id === user.store_id &&
          (deal.created_by === user.id || agents.includes(user.id)))
      )
    )
      return { ok: false, message: "成交单不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "house") {
    const house = db
      .prepare(`SELECT * FROM houses WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !house ||
      !houseVisibleTo(user, house) ||
      !(
        user.role === "admin" ||
        (user.role === "store_manager" && house.store_id === user.store_id) ||
        house.agent_id === user.id
      )
    )
      return { ok: false, message: "房源不存在或无附件权限", code: 403 };
  }
  if (payload.parent_type === "expense_request") {
    const expense = db
      .prepare(`SELECT * FROM expense_requests WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (!expense) return { ok: false, message: "报销单不存在", code: 403 };
    if (!["expense_receipt", "payment_voucher"].includes(payload.category))
      return { ok: false, message: "报销附件分类无效" };
    const canAddReceipt =
      payload.category === "expense_receipt" &&
      ["draft", "rejected"].includes(expense.status) &&
      (expense.applicant_user_id === user.id || user.role === "admin");
    const canAddVoucher =
      payload.category === "payment_voucher" &&
      ["approved", "paid"].includes(expense.status) &&
      (user.role === "finance" || user.role === "admin");
    if (!canAddReceipt && !canAddVoucher)
      return { ok: false, message: "当前状态无附件上传权限", code: 403 };
    attachmentStoreId = expense.store_id;
  }
  if (payload.parent_type === "cashbook_entry") {
    const entry = db
      .prepare(`SELECT * FROM cashbook_entries WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !entry ||
      entry.status !== "confirmed" ||
      !(user.role === "admin" || user.role === "finance")
    )
      return { ok: false, message: "收支记录不存在或无凭证上传权限", code: 403 };
    if (payload.category !== "cashbook_voucher")
      return { ok: false, message: "收支凭证分类无效" };
    attachmentStoreId = entry.store_id;
  }
  if (payload.parent_type === "recruitment_candidate") {
    const candidate = db
      .prepare(`SELECT * FROM recruitment_candidates WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    if (
      !candidate ||
      ["hired", "rejected", "withdrawn"].includes(candidate.status) ||
      !(
        user.role === "admin" ||
        (user.role === "store_manager" && candidate.store_id === user.store_id)
      )
    )
      return { ok: false, message: "候选人不存在或无简历上传权限", code: 403 };
    if (payload.category !== "resume") return { ok: false, message: "候选人附件分类无效" };
    attachmentStoreId = candidate.store_id;
  }
  if (payload.parent_type === "employee_contract") {
    const contract = db
      .prepare(`SELECT * FROM employee_contracts WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canUpload =
      contract &&
      (user.role === "admin" || contract.user_id === user.id) &&
      ((payload.category === "signed_contract" && contract.status === "draft") ||
        (payload.category === "contract_renewal" &&
          ["active", "expired"].includes(contract.status)));
    if (!canUpload)
      return { ok: false, message: "员工合同不存在或当前状态无附件上传权限", code: 403 };
    attachmentStoreId = contract.store_id;
  }
  if (payload.parent_type === "office_document") {
    const document = db
      .prepare(`SELECT * FROM office_documents WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canUpload =
      document &&
      document.status !== "archived" &&
      (user.role === "admin" ||
        (user.role === "store_manager" &&
          document.scope_type === "store" &&
          document.store_id === user.store_id));
    if (!canUpload)
      return { ok: false, message: "文档不存在或当前状态无附件上传权限", code: 403 };
    if (payload.category !== "office_document")
      return { ok: false, message: "办公文档附件分类无效" };
    attachmentStoreId = document.store_id;
  }
  if (payload.parent_type === "rental_property") {
    const property = db
      .prepare(`SELECT * FROM rental_properties WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canUpload =
      property &&
      ["draft", "active"].includes(property.status) &&
      (user.role === "admin" ||
        (user.role === "store_manager" && property.store_id === user.store_id));
    if (!canUpload)
      return { ok: false, message: "托管物业不存在或当前状态无合同上传权限", code: 403 };
    if (payload.category !== "management_contract")
      return { ok: false, message: "托管物业附件分类无效" };
    attachmentStoreId = property.store_id;
  }
  if (payload.parent_type === "rental_lease") {
    const lease = db
      .prepare(`SELECT * FROM rental_leases WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canUpload =
      lease &&
      lease.status === "draft" &&
      (user.role === "admin" ||
        (user.role === "store_manager" && lease.store_id === user.store_id));
    if (!canUpload)
      return { ok: false, message: "租约不存在或当前状态无合同上传权限", code: 403 };
    if (payload.category !== "signed_lease")
      return { ok: false, message: "租约附件分类无效" };
    attachmentStoreId = lease.store_id;
  }
  if (payload.parent_type === "rental_work_order") {
    const workOrder = db
      .prepare(`SELECT * FROM rental_work_orders WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canUpload =
      workOrder &&
      ["pending", "in_progress"].includes(workOrder.status) &&
      (user.role === "admin" ||
        (user.role === "store_manager" && workOrder.store_id === user.store_id) ||
        workOrder.assignee_user_id === user.id);
    if (!canUpload)
      return { ok: false, message: "租赁工单不存在或当前状态无凭证上传权限", code: 403 };
    if (payload.category !== "work_order_evidence")
      return { ok: false, message: "工单附件分类无效" };
    attachmentStoreId = workOrder.store_id;
  }
  if (payload.parent_type === "customer_care_case") {
    const careCase = db
      .prepare(`SELECT * FROM customer_care_cases WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canUpload =
      careCase &&
      !["closed", "withdrawn"].includes(careCase.status) &&
      user.role !== "finance" &&
      (user.role === "admin" ||
        (user.role === "store_manager" && careCase.store_id === user.store_id) ||
        careCase.created_by === user.id ||
        careCase.assignee_user_id === user.id);
    if (!canUpload)
      return { ok: false, message: "客户关怀案件不存在或当前状态无附件上传权限", code: 403 };
    const allowed =
      careCase.case_type === "lawsuit"
        ? ["legal_document", "resolution_evidence"]
        : ["complaint_evidence", "resolution_evidence"];
    if (!allowed.includes(payload.category))
      return { ok: false, message: "客户关怀案件附件分类无效" };
    attachmentStoreId = careCase.store_id;
  }
  if (payload.parent_type === "newhome_sales_report") {
    const report = db
      .prepare(`SELECT * FROM newhome_sales_reports WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canUpload =
      report &&
      ["draft", "rejected"].includes(report.status) &&
      user.role !== "finance" &&
      (user.role === "admin" ||
        (user.role === "store_manager" && report.store_id === user.store_id) ||
        report.agent_id === user.id ||
        report.created_by === user.id);
    if (!canUpload)
      return { ok: false, message: "销售报告不存在或当前状态无附件上传权限", code: 403 };
    if (!["contract_scan", "settlement_doc"].includes(payload.category))
      return { ok: false, message: "销售报告附件分类无效" };
    attachmentStoreId = report.store_id;
  }
  if (payload.parent_type === "deal_complaint") {
    const complaint = db
      .prepare(`SELECT * FROM deal_complaints WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canUpload =
      complaint &&
      ["open", "investigating"].includes(complaint.status) &&
      user.role !== "finance" &&
      (user.role === "admin" ||
        (user.role === "store_manager" && complaint.store_id === user.store_id) ||
        complaint.created_by === user.id ||
        complaint.assignee_user_id === user.id);
    if (!canUpload)
      return { ok: false, message: "成交投诉不存在或当前状态无附件上传权限", code: 403 };
    if (payload.category !== "complaint_evidence")
      return { ok: false, message: "成交投诉附件分类无效" };
    attachmentStoreId = complaint.store_id;
  }
  if (payload.parent_type === "deal_rename") {
    const rename = db
      .prepare(`SELECT * FROM deal_renames WHERE id=? AND company_id=?`)
      .get(payload.parent_id, user.company_id) as any;
    const canUpload =
      rename &&
      ["draft", "rejected"].includes(rename.status) &&
      user.role !== "finance" &&
      (user.role === "admin" ||
        (user.role === "store_manager" && rename.store_id === user.store_id) ||
        rename.created_by === user.id);
    if (!canUpload)
      return { ok: false, message: "成交更名不存在或当前状态无附件上传权限", code: 403 };
    if (payload.category !== "rename_evidence")
      return { ok: false, message: "成交更名附件分类无效" };
    attachmentStoreId = rename.store_id;
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
    attachmentStoreId,
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
  if (payload.parent_type === "deal") {
    markReceived(db, payload.parent_id, payload.category, id, user.id);
  }
  if (
    payload.parent_type === "house" &&
    payload.category === "entrustment" &&
    !linkEntrustmentAttachment(db, payload.parent_id, id)
  ) {
    db.prepare(`DELETE FROM file_attachments WHERE id=?`).run(id);
    return { ok: false, message: "请先登记生效中的业主委托" };
  }
  writeAudit(db, user, "attachment.add", "attachment", id, {
    parent_type: payload.parent_type,
    parent_id: payload.parent_id,
    category: payload.category,
    size: stat.size,
  });
  return { ok: true, data: { id, size: stat.size } };
}
