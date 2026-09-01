import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const ASSET_CATEGORIES = new Set([
  "furniture",
  "equipment",
  "vehicle",
  "electronics",
  "other",
]);
const ASSET_STATUSES = new Set(["in_use", "idle", "disposed"]);

function canRead(user: SessionUser): boolean {
  return ["admin", "finance", "store_manager"].includes(user.role);
}

function canWrite(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "finance";
}

function visible(user: SessionUser, row: any): boolean {
  return user.role === "admin" || user.role === "finance" || row.store_id === user.store_id;
}

function addEvent(
  db: Db,
  user: SessionUser,
  entityType: string,
  entityId: string,
  eventType: string,
  details: unknown = {}
) {
  db.prepare(
    `INSERT INTO finance_events(
      id, company_id, entity_type, entity_id, event_type, details, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("FNE"),
    user.company_id,
    entityType,
    entityId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function resolveStoreId(db: Db, user: SessionUser, storeId: string | null | undefined) {
  const id = storeId || user.store_id;
  const store = db
    .prepare(`SELECT * FROM stores WHERE id=? AND company_id=? AND status='active'`)
    .get(id, user.company_id) as any;
  return store || null;
}

export function financeOptions(db: Db, user: SessionUser): ApiResult {
  if (!canRead(user)) return { ok: false, message: "无权限", code: 403 };
  let stores = db
    .prepare(`SELECT id, name FROM stores WHERE company_id=? AND status='active' ORDER BY name`)
    .all(user.company_id) as any[];
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' AND role<>'finance'
       ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  if (user.role === "store_manager") {
    stores = stores.filter((store) => store.id === user.store_id);
    users = users.filter((row) => row.store_id === user.store_id);
  }
  return { ok: true, data: { stores, users } };
}

export function listAssets(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!canRead(user)) return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT a.*, s.name AS store_name, u.display_name AS custodian_name,
              c.display_name AS created_by_name
       FROM finance_assets a
       JOIN stores s ON s.id=a.store_id
       LEFT JOIN users u ON u.id=a.custodian_user_id
       JOIN users c ON c.id=a.created_by
       WHERE a.company_id=?
       ORDER BY a.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.store_id) rows = rows.filter((row) => row.store_id === payload.store_id);
  if (payload.category) rows = rows.filter((row) => row.category === payload.category);
  if (payload.keyword) {
    const keyword = String(payload.keyword);
    rows = rows.filter(
      (row) =>
        row.name.includes(keyword) ||
        row.code.includes(keyword) ||
        (row.location || "").includes(keyword)
    );
  }
  return { ok: true, data: rows };
}

export function saveAsset(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWrite(user)) return { ok: false, message: "无权限", code: 403 };
  const code = String(payload.code || "").trim();
  const name = String(payload.name || "").trim();
  if (!code || !name) return { ok: false, message: "资产编码和名称必填" };
  if (!ASSET_CATEGORIES.has(payload.category))
    return { ok: false, message: "资产分类无效" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.purchase_date || "")))
    return { ok: false, message: "购置日期无效" };
  const originalValue = Number(payload.original_value);
  if (!Number.isFinite(originalValue) || originalValue <= 0)
    return { ok: false, message: "原值须大于 0" };
  const residualValue = Number(payload.residual_value ?? 0);
  if (!Number.isFinite(residualValue) || residualValue < 0 || residualValue > originalValue)
    return { ok: false, message: "残值须在 0 到原值之间" };
  const quantity = Number(payload.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 0)
    return { ok: false, message: "数量须大于 0" };
  const store = resolveStoreId(db, user, payload.store_id);
  if (!store) return { ok: false, message: "门店无效" };
  let custodianId = payload.custodian_user_id || null;
  if (custodianId) {
    const custodian = db
      .prepare(
        `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=? AND status='active'`
      )
      .get(custodianId, user.company_id, store.id);
    if (!custodian) return { ok: false, message: "保管人须为该店在职员工" };
  }
  const now = nowIso();
  if (payload.id) {
    const row = db
      .prepare(`SELECT * FROM finance_assets WHERE id=? AND company_id=?`)
      .get(payload.id, user.company_id) as any;
    if (!row) return { ok: false, message: "资产不存在", code: 404 };
    if (row.status === "disposed") return { ok: false, message: "已处置资产不可修改" };
    try {
      db.prepare(
        `UPDATE finance_assets
         SET code=?, name=?, category=?, purchase_date=?, original_value=?,
             residual_value=?, quantity=?, unit=?, custodian_user_id=?, location=?,
             status=?, remark=?, store_id=?, updated_at=?
         WHERE id=?`
      ).run(
        code,
        name,
        payload.category,
        payload.purchase_date,
        originalValue,
        residualValue,
        quantity,
        String(payload.unit || "").trim() || null,
        custodianId,
        String(payload.location || "").trim() || null,
        payload.status === "idle" ? "idle" : "in_use",
        String(payload.remark || "").trim() || null,
        store.id,
        now,
        row.id
      );
    } catch {
      return { ok: false, message: "资产编码已存在", code: 409 };
    }
    addEvent(db, user, "asset", row.id, "updated", { code, name });
    writeAudit(db, user, "finance.asset.update", "finance_asset", row.id);
    const recipients = new Set<string>();
    if (custodianId) recipients.add(custodianId);
    if (row.custodian_user_id) recipients.add(row.custodian_user_id);
    recipients.delete(user.id);
    for (const userId of recipients) {
      createMessage(db, {
        company_id: user.company_id,
        store_id: store.id,
        user_id: userId,
        title: "固定资产已更新",
        body: `${code} · ${name}`,
        kind: "business_record_status",
        ref_type: "finance_asset",
        ref_id: row.id,
      });
    }
    return { ok: true, data: { id: row.id } };
  }
  const id = nextId("FAS");
  try {
    db.prepare(
      `INSERT INTO finance_assets(
         id, company_id, store_id, code, name, category, purchase_date,
         original_value, residual_value, quantity, unit, custodian_user_id,
         location, status, remark, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_use', ?, ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      store.id,
      code,
      name,
      payload.category,
      payload.purchase_date,
      originalValue,
      residualValue,
      quantity,
      String(payload.unit || "").trim() || null,
      custodianId,
      String(payload.location || "").trim() || null,
      String(payload.remark || "").trim() || null,
      user.id,
      now,
      now
    );
  } catch {
    return { ok: false, message: "资产编码已存在", code: 409 };
  }
  addEvent(db, user, "asset", id, "created", { code, name });
  writeAudit(db, user, "finance.asset.create", "finance_asset", id);
  return { ok: true, data: { id, status: "in_use" } };
}

export function disposeAsset(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWrite(user)) return { ok: false, message: "无权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "处置原因至少 2 个字" };
  const amount =
    payload.dispose_amount === undefined ||
    payload.dispose_amount === null ||
    payload.dispose_amount === ""
      ? 0
      : Number(payload.dispose_amount);
  if (!Number.isFinite(amount) || amount < 0)
    return { ok: false, message: "处置金额无效" };
  const row = db
    .prepare(`SELECT * FROM finance_assets WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "资产不存在", code: 404 };
  if (row.status === "disposed") return { ok: false, message: "资产已处置" };
  const now = nowIso();
  db.prepare(
    `UPDATE finance_assets
     SET status='disposed', disposed_at=?, dispose_reason=?, dispose_amount=?, updated_at=?
     WHERE id=?`
  ).run(now, reason, amount, now, row.id);
  addEvent(db, user, "asset", row.id, "disposed", { reason, dispose_amount: amount });
  writeAudit(db, user, "finance.asset.dispose", "finance_asset", row.id, { reason });
  return { ok: true, data: { id: row.id, status: "disposed" } };
}

function nextVoucherNo(db: Db, companyId: string, voucherDate: string): string {
  const prefix = `V${voucherDate.replace(/-/g, "")}`;
  const latest = db
    .prepare(
      `SELECT voucher_no FROM finance_vouchers
       WHERE company_id=? AND voucher_no LIKE ? ORDER BY voucher_no DESC LIMIT 1`
    )
    .get(companyId, `${prefix}%`) as any;
  const seq = latest ? Number(String(latest.voucher_no).slice(-4)) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

function normalizeLines(payload: any): ApiResult & { lines?: any[] } {
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (lines.length < 2) return { ok: false, message: "凭证至少两行分录" };
  const normalized = [];
  let debit = 0;
  let credit = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const accountName = String(line.account_name || "").trim();
    if (accountName.length < 1) return { ok: false, message: `第 ${i + 1} 行科目名称必填` };
    if (!["debit", "credit"].includes(line.direction))
      return { ok: false, message: `第 ${i + 1} 行借贷方向无效` };
    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return { ok: false, message: `第 ${i + 1} 行金额须大于 0` };
    if (line.direction === "debit") debit += amount;
    else credit += amount;
    normalized.push({
      account_name: accountName,
      direction: line.direction,
      amount,
      memo: String(line.memo || "").trim() || null,
    });
  }
  if (Math.abs(debit - credit) > 0.009)
    return { ok: false, message: "借方合计须等于贷方合计" };
  return { ok: true, data: { debit, credit }, lines: normalized };
}

export function listVouchers(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!canRead(user)) return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT v.*, s.name AS store_name, c.display_name AS created_by_name,
              p.display_name AS posted_by_name,
              (SELECT COUNT(*) FROM finance_voucher_lines l WHERE l.voucher_id=v.id) AS line_count
       FROM finance_vouchers v
       JOIN stores s ON s.id=v.store_id
       JOIN users c ON c.id=v.created_by
       LEFT JOIN users p ON p.id=v.posted_by
       WHERE v.company_id=?
       ORDER BY v.voucher_date DESC, v.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.store_id) rows = rows.filter((row) => row.store_id === payload.store_id);
  return { ok: true, data: rows };
}

export function getVoucher(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canRead(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(
      `SELECT v.*, s.name AS store_name FROM finance_vouchers v
       JOIN stores s ON s.id=v.store_id
       WHERE v.id=? AND v.company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (!row || !visible(user, row))
    return { ok: false, message: "凭证不存在或无权限", code: 403 };
  const lines = db
    .prepare(
      `SELECT * FROM finance_voucher_lines WHERE voucher_id=? ORDER BY line_no ASC`
    )
    .all(row.id) as any[];
  return { ok: true, data: { ...row, lines } };
}

export function createVoucher(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWrite(user)) return { ok: false, message: "无权限", code: 403 };
  const summary = String(payload.summary || "").trim();
  if (summary.length < 2) return { ok: false, message: "摘要至少 2 个字" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.voucher_date || "")))
    return { ok: false, message: "凭证日期无效" };
  const store = resolveStoreId(db, user, payload.store_id);
  if (!store) return { ok: false, message: "门店无效" };
  const normalized = normalizeLines(payload);
  if (!normalized.ok) return normalized;
  if (payload.source_type || payload.source_id) {
    if (!payload.source_type || !payload.source_id)
      return { ok: false, message: "来源类型与来源单号须同时填写" };
    if (!["cashbook_entry", "expense_request", "deal"].includes(payload.source_type))
      return { ok: false, message: "来源类型无效" };
  }
  const totals = normalized.data as any;
  const id = nextId("FVC");
  const now = nowIso();
  const voucherNo = nextVoucherNo(db, user.company_id, payload.voucher_date);
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO finance_vouchers(
         id, company_id, store_id, voucher_no, voucher_date, summary,
         debit_total, credit_total, status, source_type, source_id,
         created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      store.id,
      voucherNo,
      payload.voucher_date,
      summary,
      totals.debit,
      totals.credit,
      payload.source_type || null,
      payload.source_id || null,
      user.id,
      now,
      now
    );
    normalized.lines!.forEach((line, index) => {
      db.prepare(
        `INSERT INTO finance_voucher_lines(
           id, company_id, voucher_id, line_no, account_name, direction, amount, memo
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        nextId("FVL"),
        user.company_id,
        id,
        index + 1,
        line.account_name,
        line.direction,
        line.amount,
        line.memo
      );
    });
  });
  tx();
  addEvent(db, user, "voucher", id, "created", { voucher_no: voucherNo });
  writeAudit(db, user, "finance.voucher.create", "finance_voucher", id);
  return { ok: true, data: { id, voucher_no: voucherNo, status: "draft" } };
}

export function updateVoucher(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWrite(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM finance_vouchers WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "凭证不存在", code: 404 };
  if (row.status !== "draft") return { ok: false, message: "仅草稿凭证可修改" };
  const summary = String(payload.summary || "").trim();
  if (summary.length < 2) return { ok: false, message: "摘要至少 2 个字" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.voucher_date || "")))
    return { ok: false, message: "凭证日期无效" };
  const store = resolveStoreId(db, user, payload.store_id || row.store_id);
  if (!store) return { ok: false, message: "门店无效" };
  const normalized = normalizeLines(payload);
  if (!normalized.ok) return normalized;
  const totals = normalized.data as any;
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE finance_vouchers
       SET voucher_date=?, summary=?, debit_total=?, credit_total=?, store_id=?, updated_at=?
       WHERE id=?`
    ).run(
      payload.voucher_date,
      summary,
      totals.debit,
      totals.credit,
      store.id,
      now,
      row.id
    );
    db.prepare(`DELETE FROM finance_voucher_lines WHERE voucher_id=?`).run(row.id);
    normalized.lines!.forEach((line, index) => {
      db.prepare(
        `INSERT INTO finance_voucher_lines(
           id, company_id, voucher_id, line_no, account_name, direction, amount, memo
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        nextId("FVL"),
        user.company_id,
        row.id,
        index + 1,
        line.account_name,
        line.direction,
        line.amount,
        line.memo
      );
    });
  });
  tx();
  addEvent(db, user, "voucher", row.id, "updated");
  writeAudit(db, user, "finance.voucher.update", "finance_voucher", row.id);
  return { ok: true, data: { id: row.id, status: "draft" } };
}

export function postVoucher(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWrite(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM finance_vouchers WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "凭证不存在", code: 404 };
  if (row.status !== "draft") return { ok: false, message: "仅草稿凭证可过账" };
  if (Math.abs(row.debit_total - row.credit_total) > 0.009)
    return { ok: false, message: "借贷不平衡，不可过账" };
  const lineCount = db
    .prepare(`SELECT COUNT(*) AS c FROM finance_voucher_lines WHERE voucher_id=?`)
    .get(row.id) as any;
  if (Number(lineCount?.c || 0) < 2) return { ok: false, message: "分录不足两行" };
  const now = nowIso();
  db.prepare(
    `UPDATE finance_vouchers
     SET status='posted', posted_by=?, posted_at=?, updated_at=? WHERE id=?`
  ).run(user.id, now, now, row.id);
  addEvent(db, user, "voucher", row.id, "posted");
  writeAudit(db, user, "finance.voucher.post", "finance_voucher", row.id);
  return { ok: true, data: { id: row.id, status: "posted" } };
}

export function voidVoucher(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWrite(user)) return { ok: false, message: "无权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (reason.length < 2) return { ok: false, message: "作废原因至少 2 个字" };
  const row = db
    .prepare(`SELECT * FROM finance_vouchers WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row) return { ok: false, message: "凭证不存在", code: 404 };
  if (!["draft", "posted"].includes(row.status))
    return { ok: false, message: "当前凭证不可作废" };
  const now = nowIso();
  db.prepare(
    `UPDATE finance_vouchers
     SET status='voided', void_reason=?, voided_by=?, voided_at=?, updated_at=? WHERE id=?`
  ).run(reason, user.id, now, now, row.id);
  addEvent(db, user, "voucher", row.id, "voided", { reason });
  writeAudit(db, user, "finance.voucher.void", "finance_voucher", row.id, { reason });
  return { ok: true, data: { id: row.id, status: "voided" } };
}
