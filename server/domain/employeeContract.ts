import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso, todayDate } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const CONTRACT_TYPES = new Set(["labor", "confidentiality", "noncompete"]);

function visible(user: SessionUser, row: any): boolean {
  if (user.role === "admin") return true;
  if (user.role === "store_manager") return row.store_id === user.store_id;
  return row.user_id === user.id;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addEvent(
  db: Db,
  user: SessionUser,
  contractId: string,
  eventType: string,
  details: Record<string, unknown> = {}
) {
  db.prepare(
    `INSERT INTO employee_contract_events(
      id, company_id, contract_id, event_type, details_json, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("HCE"),
    user.company_id,
    contractId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

export function contractOptions(db: Db, user: SessionUser): ApiResult {
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' AND role<>'admin' ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  if (user.role === "store_manager")
    users = users.filter((employee) => employee.store_id === user.store_id);
  if (!["admin", "store_manager"].includes(user.role))
    users = users.filter((employee) => employee.id === user.id);
  return { ok: true, data: { users } };
}

export function listContracts(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT c.*, u.display_name AS employee_name, u.role AS employee_role,
       s.name AS store_name,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='employee_contract' AND a.parent_id=c.id
        AND a.category='signed_contract') AS signed_attachment_count,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='employee_contract' AND a.parent_id=c.id
        AND a.category='contract_renewal') AS renewal_attachment_count
       FROM employee_contracts c JOIN users u ON u.id=c.user_id
       JOIN stores s ON s.id=c.store_id
       WHERE c.company_id=? ORDER BY c.end_date, c.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.user_id) rows = rows.filter((row) => row.user_id === payload.user_id);
  if (payload.expiring_before)
    rows = rows.filter(
      (row) => row.status === "active" && row.end_date <= payload.expiring_before
    );
  return { ok: true, data: rows };
}

export function listContractEvents(db: Db, user: SessionUser, payload: any): ApiResult {
  const contract = db
    .prepare(`SELECT * FROM employee_contracts WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!contract || !visible(user, contract))
    return { ok: false, message: "员工合同不存在或无权限", code: 403 };
  const rows = db
    .prepare(
      `SELECT e.*, u.display_name AS created_by_name FROM employee_contract_events e
       JOIN users u ON u.id=e.created_by WHERE e.contract_id=? ORDER BY e.created_at`
    )
    .all(contract.id) as any[];
  return {
    ok: true,
    data: rows.map((row) => {
      let details = {};
      try {
        details = JSON.parse(row.details_json || "{}");
      } catch {
        details = {};
      }
      return { ...row, details };
    }),
  };
}

export function createContract(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可登记合同", code: 403 };
  if (!CONTRACT_TYPES.has(payload.contract_type))
    return { ok: false, message: "合同类型无效" };
  const contractNo = String(payload.contract_no || "").trim();
  if (!contractNo) return { ok: false, message: "合同编号必填" };
  if (
    !validDate(payload.start_date) ||
    !validDate(payload.end_date) ||
    payload.end_date <= payload.start_date
  )
    return { ok: false, message: "合同起止日期无效" };
  if (
    payload.probation_end_date &&
    (!validDate(payload.probation_end_date) ||
      payload.probation_end_date < payload.start_date ||
      payload.probation_end_date > payload.end_date)
  )
    return { ok: false, message: "试用期结束日期须在合同期限内" };
  if (payload.signed_at && (!validDate(payload.signed_at) || payload.signed_at > todayDate()))
    return { ok: false, message: "签署日期无效" };
  const employee = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.user_id, user.company_id) as any;
  if (!employee || employee.role === "admin") return { ok: false, message: "员工无效" };
  const overlap = db
    .prepare(
      `SELECT id FROM employee_contracts WHERE company_id=? AND user_id=?
       AND contract_type=? AND status IN ('draft','active')
       AND start_date<=? AND end_date>=?`
    )
    .get(
      user.company_id,
      employee.id,
      payload.contract_type,
      payload.end_date,
      payload.start_date
    );
  if (overlap) return { ok: false, message: "该员工已有期限重叠的同类合同", code: 409 };
  const id = nextId("HCT");
  const now = nowIso();
  try {
    db.prepare(
      `INSERT INTO employee_contracts(
        id, company_id, store_id, user_id, contract_type, contract_no,
        start_date, end_date, probation_end_date, signed_at, status,
        remark, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      employee.store_id,
      employee.id,
      payload.contract_type,
      contractNo,
      payload.start_date,
      payload.end_date,
      payload.probation_end_date || null,
      payload.signed_at || null,
      String(payload.remark || "").trim() || null,
      user.id,
      now,
      now
    );
  } catch {
    return { ok: false, message: "合同编号已存在", code: 409 };
  }
  addEvent(db, user, id, "created", {
    start_date: payload.start_date,
    end_date: payload.end_date,
  });
  writeAudit(db, user, "employee_contract.create", "employee_contract", id);
  return { ok: true, data: { id, status: "draft" } };
}

export function signContract(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可登记签署", code: 403 };
  if (!validDate(payload.signed_at) || payload.signed_at > todayDate())
    return { ok: false, message: "签署日期无效" };
  const row = db
    .prepare(`SELECT * FROM employee_contracts WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.status !== "draft") return { ok: false, message: "仅草稿合同可登记签署" };
  db.prepare(`UPDATE employee_contracts SET signed_at=?, updated_at=? WHERE id=?`).run(
    payload.signed_at,
    nowIso(),
    row.id
  );
  addEvent(db, user, row.id, "signed", { signed_at: payload.signed_at });
  writeAudit(db, user, "employee_contract.sign", "employee_contract", row.id, {
    signed_at: payload.signed_at,
  });
  return { ok: true, data: { id: row.id, signed_at: payload.signed_at } };
}

export function activateContract(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可启用合同", code: 403 };
  const row = db
    .prepare(`SELECT * FROM employee_contracts WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.status !== "draft") return { ok: false, message: "仅草稿合同可启用" };
  if (!row.signed_at) return { ok: false, message: "请先登记签署日期" };
  const attachment = db
    .prepare(
      `SELECT COUNT(*) AS c FROM file_attachments WHERE company_id=?
       AND parent_type='employee_contract' AND parent_id=? AND category='signed_contract'`
    )
    .get(user.company_id, row.id) as { c: number };
  if (!attachment.c) return { ok: false, message: "请先上传已签合同附件" };
  const now = nowIso();
  db.prepare(
    `UPDATE employee_contracts SET status='active', updated_at=? WHERE id=?`
  ).run(now, row.id);
  addEvent(db, user, row.id, "activated", { signed_at: row.signed_at });
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.user_id,
    title: "员工合同已启用",
    body: `${row.contract_no} · ${row.start_date} 至 ${row.end_date}`,
    kind: "employee_contract",
    ref_type: "employee_contract",
    ref_id: row.id,
  });
  writeAudit(db, user, "employee_contract.activate", "employee_contract", row.id);
  return { ok: true, data: { id: row.id, status: "active" } };
}

export function renewContract(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可续签合同", code: 403 };
  const row = db
    .prepare(`SELECT * FROM employee_contracts WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !["active", "expired"].includes(row.status))
    return { ok: false, message: "仅生效或到期合同可续签" };
  if (!validDate(payload.end_date) || payload.end_date <= row.end_date)
    return { ok: false, message: "续签到期日须晚于当前到期日" };
  const overlap = db
    .prepare(
      `SELECT id FROM employee_contracts WHERE company_id=? AND user_id=?
       AND contract_type=? AND id<>? AND status IN ('draft','active')
       AND start_date<=? AND end_date>=?`
    )
    .get(
      user.company_id,
      row.user_id,
      row.contract_type,
      row.id,
      payload.end_date,
      row.start_date
    );
  if (overlap) return { ok: false, message: "续签期限与其他同类合同重叠", code: 409 };
  const renewals = db
    .prepare(
      `SELECT COUNT(*) AS c FROM employee_contract_events
       WHERE contract_id=? AND event_type='renewed'`
    )
    .get(row.id) as { c: number };
  const attachments = db
    .prepare(
      `SELECT COUNT(*) AS c FROM file_attachments WHERE company_id=?
       AND parent_type='employee_contract' AND parent_id=? AND category='contract_renewal'`
    )
    .get(user.company_id, row.id) as { c: number };
  if (attachments.c <= renewals.c)
    return { ok: false, message: "请先上传本次续签附件" };
  const oldEnd = row.end_date;
  const now = nowIso();
  db.prepare(
    `UPDATE employee_contracts SET end_date=?, status='active', updated_at=? WHERE id=?`
  ).run(payload.end_date, now, row.id);
  addEvent(db, user, row.id, "renewed", {
    from_end_date: oldEnd,
    to_end_date: payload.end_date,
  });
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.user_id,
    title: "员工合同已续签",
    body: `${row.contract_no} 新到期日 ${payload.end_date}`,
    kind: "employee_contract",
    ref_type: "employee_contract",
    ref_id: row.id,
  });
  writeAudit(db, user, "employee_contract.renew", "employee_contract", row.id, {
    from_end_date: oldEnd,
    to_end_date: payload.end_date,
  });
  return { ok: true, data: { id: row.id, status: "active", end_date: payload.end_date } };
}

export function terminateContract(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可终止合同", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "终止原因必填" };
  const row = db
    .prepare(`SELECT * FROM employee_contracts WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.status !== "active") return { ok: false, message: "仅生效合同可终止" };
  const now = nowIso();
  db.prepare(
    `UPDATE employee_contracts SET status='terminated', terminated_at=?,
     termination_reason=?, updated_at=? WHERE id=?`
  ).run(now, reason, now, row.id);
  addEvent(db, user, row.id, "terminated", { reason });
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.user_id,
    title: "员工合同已终止",
    body: `${row.contract_no} · ${reason}`,
    kind: "employee_contract",
    ref_type: "employee_contract",
    ref_id: row.id,
  });
  writeAudit(db, user, "employee_contract.terminate", "employee_contract", row.id, {
    reason,
  });
  return { ok: true, data: { id: row.id, status: "terminated" } };
}

export function expireContracts(db: Db, user: SessionUser): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可刷新到期合同", code: 403 };
  const rows = db
    .prepare(
      `SELECT * FROM employee_contracts WHERE company_id=? AND status='active'
       AND end_date<?`
    )
    .all(user.company_id, todayDate()) as any[];
  const now = nowIso();
  const transaction = db.transaction(() => {
    for (const row of rows) {
      db.prepare(
        `UPDATE employee_contracts SET status='expired', updated_at=? WHERE id=?`
      ).run(now, row.id);
      addEvent(db, user, row.id, "expired", { end_date: row.end_date });
    }
  });
  transaction();
  for (const row of rows) {
    if (row.user_id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.user_id,
      title: "员工合同已到期",
      body: `${row.contract_no} · 到期日 ${row.end_date}`,
      kind: "employee_contract",
      ref_type: "employee_contract",
      ref_id: row.id,
    });
  }
  if (rows.length)
    writeAudit(db, user, "employee_contract.expire", "employee_contract", undefined, {
      count: rows.length,
    });
  return { ok: true, data: { expired: rows.length } };
}
