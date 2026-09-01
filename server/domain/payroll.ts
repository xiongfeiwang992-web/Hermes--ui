import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function money(value: unknown): number {
  return Math.round(Number(value) * 100) / 100;
}

function validAmount(value: unknown): boolean {
  return Number.isFinite(Number(value)) && Number(value) >= 0;
}

function maskBank(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 4 ? "****" : `****${value.slice(-4)}`;
}

function addEvent(
  db: Db,
  user: SessionUser,
  batchId: string,
  eventType: string,
  details: Record<string, unknown> = {}
) {
  db.prepare(
    `INSERT INTO payroll_events(
      id, company_id, batch_id, event_type, details_json, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("PYE"),
    user.company_id,
    batchId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function recalculateBatch(db: Db, batchId: string) {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(gross_amount),0) AS gross,
       COALESCE(SUM(net_amount),0) AS net FROM payroll_items WHERE batch_id=?`
    )
    .get(batchId) as any;
  db.prepare(
    `UPDATE payroll_batches SET employee_count=?, gross_total=?, net_total=?,
     updated_at=? WHERE id=?`
  ).run(totals.c, money(totals.gross), money(totals.net), nowIso(), batchId);
}

export function listSalaryProfiles(db: Db, user: SessionUser): ApiResult {
  let rows = db
    .prepare(
      `SELECT p.*, u.display_name, u.role, u.status AS employee_status,
       u.store_id AS current_store_id, s.name AS store_name
       FROM salary_profiles p JOIN users u ON u.id=p.user_id
       JOIN stores s ON s.id=u.store_id WHERE p.company_id=? ORDER BY u.display_name`
    )
    .all(user.company_id) as any[];
  if (!(user.role === "admin" || user.role === "finance"))
    rows = rows.filter((row) => row.user_id === user.id);
  return {
    ok: true,
    data: rows.map((row) => ({ ...row, bank_account: maskBank(row.bank_account) })),
  };
}

export function payrollOptions(db: Db, user: SessionUser): ApiResult {
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' AND role<>'admin' ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  if (user.role !== "admin") users = users.filter((employee) => employee.id === user.id);
  return { ok: true, data: { users } };
}

export function saveSalaryProfile(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可维护薪资档案", code: 403 };
  if (
    !validAmount(payload.base_salary) ||
    !validAmount(payload.fixed_allowance) ||
    !validAmount(payload.fixed_deduction)
  )
    return { ok: false, message: "薪资金额须为非负数" };
  const employee = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=? AND status='active'`)
    .get(payload.user_id, user.company_id) as any;
  if (!employee || employee.role === "admin") return { ok: false, message: "员工无效" };
  const bankName = String(payload.bank_name || "").trim();
  const bankAccount = String(payload.bank_account || "").trim();
  if (!bankName || bankAccount.length < 4) return { ok: false, message: "发薪银行和账号必填" };
  const now = nowIso();
  db.prepare(
    `INSERT INTO salary_profiles(
      user_id, company_id, store_id, base_salary, fixed_allowance,
      fixed_deduction, bank_name, bank_account, status, updated_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET store_id=excluded.store_id,
    base_salary=excluded.base_salary, fixed_allowance=excluded.fixed_allowance,
    fixed_deduction=excluded.fixed_deduction, bank_name=excluded.bank_name,
    bank_account=excluded.bank_account, status='active',
    updated_by=excluded.updated_by, updated_at=excluded.updated_at`
  ).run(
    employee.id,
    user.company_id,
    employee.store_id,
    money(payload.base_salary),
    money(payload.fixed_allowance),
    money(payload.fixed_deduction),
    bankName,
    bankAccount,
    user.id,
    now,
    now
  );
  writeAudit(db, user, "salary_profile.save", "user", employee.id, {
    base_salary: money(payload.base_salary),
    fixed_allowance: money(payload.fixed_allowance),
    fixed_deduction: money(payload.fixed_deduction),
  });
  return { ok: true, data: { user_id: employee.id } };
}

export function listPayrollBatches(db: Db, user: SessionUser): ApiResult {
  let rows = db
    .prepare(
      `SELECT b.*, approver.display_name AS approver_name,
       payer.display_name AS payer_name FROM payroll_batches b
       LEFT JOIN users approver ON approver.id=b.approved_by
       LEFT JOIN users payer ON payer.id=b.paid_by
       WHERE b.company_id=? ORDER BY b.payroll_month DESC`
    )
    .all(user.company_id) as any[];
  if (!(user.role === "admin" || user.role === "finance")) {
    rows = rows.filter((batch) => {
      if (!["approved", "paid"].includes(batch.status)) return false;
      return Boolean(
        db
          .prepare(`SELECT 1 FROM payroll_items WHERE batch_id=? AND user_id=?`)
          .get(batch.id, user.id)
      );
    });
  }
  return { ok: true, data: rows };
}

export function createPayrollBatch(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可创建工资批次", code: 403 };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(payload.payroll_month || "")))
    return { ok: false, message: "工资月份无效" };
  const id = nextId("PYB");
  const now = nowIso();
  try {
    db.prepare(
      `INSERT INTO payroll_batches(
        id, company_id, payroll_month, status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 'draft', ?, ?, ?)`
    ).run(id, user.company_id, payload.payroll_month, user.id, now, now);
  } catch {
    return { ok: false, message: "该月份工资批次已存在", code: 409 };
  }
  addEvent(db, user, id, "created", { payroll_month: payload.payroll_month });
  writeAudit(db, user, "payroll.batch.create", "payroll_batch", id);
  const financeUsers = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND role='finance' AND status='active'`
    )
    .all(user.company_id) as any[];
  for (const finance of financeUsers) {
    if (finance.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      user_id: finance.id,
      title: "工资批次已创建",
      body: `${payload.payroll_month} 草稿待核算`,
      kind: "payroll",
      ref_type: "payroll_batch",
      ref_id: id,
    });
  }
  return { ok: true, data: { id, status: "draft" } };
}

export function calculatePayroll(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "finance") return { ok: false, message: "仅财务可计算工资", code: 403 };
  const batch = db
    .prepare(`SELECT * FROM payroll_batches WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!batch || !["draft", "calculated"].includes(batch.status))
    return { ok: false, message: "当前工资批次不可计算" };
  const profiles = db
    .prepare(
      `SELECT p.*, u.store_id AS current_store_id FROM salary_profiles p
       JOIN users u ON u.id=p.user_id
       WHERE p.company_id=? AND p.status='active' AND u.status='active'`
    )
    .all(user.company_id) as any[];
  if (!profiles.length) return { ok: false, message: "没有可用的在职员工薪资档案" };
  const now = nowIso();
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM payroll_items WHERE batch_id=?`).run(batch.id);
    for (const profile of profiles) {
      const base = money(profile.base_salary);
      const allowance = money(profile.fixed_allowance);
      const deduction = money(profile.fixed_deduction);
      const gross = money(base + allowance);
      if (deduction > gross) throw new Error("固定扣款不可超过应发金额");
      db.prepare(
        `INSERT INTO payroll_items(
          id, company_id, batch_id, store_id, user_id, base_salary,
          allowance, bonus, deduction, tax, gross_amount, net_amount,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)`
      ).run(
        nextId("PYI"),
        user.company_id,
        batch.id,
        profile.current_store_id,
        profile.user_id,
        base,
        allowance,
        deduction,
        gross,
        money(gross - deduction),
        now,
        now
      );
    }
    db.prepare(
      `UPDATE payroll_batches SET status='calculated', updated_at=? WHERE id=?`
    ).run(now, batch.id);
    recalculateBatch(db, batch.id);
  });
  try {
    transaction();
  } catch (error: any) {
    return { ok: false, message: error?.message || "工资计算失败" };
  }
  addEvent(db, user, batch.id, "calculated", { employees: profiles.length });
  writeAudit(db, user, "payroll.calculate", "payroll_batch", batch.id, {
    employees: profiles.length,
  });
  return { ok: true, data: { id: batch.id, status: "calculated", employees: profiles.length } };
}

export function listPayrollItems(db: Db, user: SessionUser, payload: any): ApiResult {
  const batch = db
    .prepare(`SELECT * FROM payroll_batches WHERE id=? AND company_id=?`)
    .get(payload.batch_id, user.company_id) as any;
  if (!batch) return { ok: false, message: "工资批次不存在", code: 403 };
  if (
    !(user.role === "admin" || user.role === "finance") &&
    !["approved", "paid"].includes(batch.status)
  )
    return { ok: false, message: "工资条尚未发布", code: 403 };
  let rows = db
    .prepare(
      `SELECT i.*, u.display_name, u.role, s.name AS store_name
       FROM payroll_items i JOIN users u ON u.id=i.user_id
       JOIN stores s ON s.id=i.store_id WHERE i.batch_id=? ORDER BY u.display_name`
    )
    .all(batch.id) as any[];
  if (!(user.role === "admin" || user.role === "finance"))
    rows = rows.filter((item) => item.user_id === user.id);
  return { ok: true, data: rows };
}

export function adjustPayrollItem(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "finance") return { ok: false, message: "仅财务可调整工资", code: 403 };
  const item = db
    .prepare(
      `SELECT i.*, b.status AS batch_status FROM payroll_items i
       JOIN payroll_batches b ON b.id=i.batch_id WHERE i.id=? AND i.company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (!item || item.batch_status !== "calculated")
    return { ok: false, message: "仅已计算批次可调整" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "调整原因必填" };
  for (const field of ["allowance", "bonus", "deduction", "tax"]) {
    if (!validAmount(payload[field])) return { ok: false, message: "调整金额须为非负数" };
  }
  const allowance = money(payload.allowance);
  const bonus = money(payload.bonus);
  const deduction = money(payload.deduction);
  const tax = money(payload.tax);
  const gross = money(Number(item.base_salary) + allowance + bonus);
  if (deduction + tax > gross) return { ok: false, message: "扣款和税额不可超过应发金额" };
  const net = money(gross - deduction - tax);
  const now = nowIso();
  db.prepare(
    `UPDATE payroll_items SET allowance=?, bonus=?, deduction=?, tax=?,
     gross_amount=?, net_amount=?, adjustment_reason=?, updated_at=? WHERE id=?`
  ).run(allowance, bonus, deduction, tax, gross, net, reason, now, item.id);
  recalculateBatch(db, item.batch_id);
  addEvent(db, user, item.batch_id, "item_adjusted", {
    item_id: item.id,
    user_id: item.user_id,
    reason,
    net_amount: net,
  });
  writeAudit(db, user, "payroll.item.adjust", "payroll_item", item.id, {
    reason,
    net_amount: net,
  });
  return { ok: true, data: { id: item.id, gross_amount: gross, net_amount: net } };
}

export function approvePayroll(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可审批工资", code: 403 };
  const batch = db
    .prepare(`SELECT * FROM payroll_batches WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!batch || batch.status !== "calculated" || Number(batch.employee_count) < 1)
    return { ok: false, message: "仅已计算且含工资条的批次可审批" };
  const now = nowIso();
  db.prepare(
    `UPDATE payroll_batches SET status='approved', approved_by=?,
     approved_at=?, updated_at=? WHERE id=?`
  ).run(user.id, now, now, batch.id);
  const items = db.prepare(`SELECT user_id FROM payroll_items WHERE batch_id=?`).all(batch.id) as any[];
  for (const item of items) {
    createMessage(db, {
      company_id: user.company_id,
      user_id: item.user_id,
      title: `${batch.payroll_month} 工资条已发布`,
      body: "工资条已审批，可在薪酬管理中查看",
      kind: "payroll",
      ref_type: "payroll_batch",
      ref_id: batch.id,
    });
  }
  addEvent(db, user, batch.id, "approved", { employees: batch.employee_count });
  writeAudit(db, user, "payroll.approve", "payroll_batch", batch.id);
  return { ok: true, data: { id: batch.id, status: "approved" } };
}

export function payPayroll(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "finance") return { ok: false, message: "仅财务可登记发薪", code: 403 };
  const reference = String(payload.payment_reference || "").trim();
  if (!reference) return { ok: false, message: "发薪流水号必填" };
  const batch = db
    .prepare(`SELECT * FROM payroll_batches WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!batch || batch.status !== "approved") return { ok: false, message: "仅已审批批次可发薪" };
  const now = nowIso();
  db.prepare(
    `UPDATE payroll_batches SET status='paid', paid_by=?, paid_at=?,
     payment_reference=?, updated_at=? WHERE id=?`
  ).run(user.id, now, reference, now, batch.id);
  const items = db.prepare(`SELECT user_id FROM payroll_items WHERE batch_id=?`).all(batch.id) as any[];
  for (const item of items) {
    createMessage(db, {
      company_id: user.company_id,
      user_id: item.user_id,
      title: `${batch.payroll_month} 工资已发放`,
      body: `发薪流水号：${reference}`,
      kind: "payroll",
      ref_type: "payroll_batch",
      ref_id: batch.id,
    });
  }
  addEvent(db, user, batch.id, "paid", { payment_reference: reference });
  writeAudit(db, user, "payroll.pay", "payroll_batch", batch.id, {
    payment_reference: reference,
    net_total: batch.net_total,
  });
  return { ok: true, data: { id: batch.id, status: "paid" } };
}

export function listPayrollEvents(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "finance"))
    return { ok: false, message: "无权限", code: 403 };
  const batch = db
    .prepare(`SELECT id FROM payroll_batches WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id);
  if (!batch) return { ok: false, message: "工资批次不存在" };
  const rows = db
    .prepare(
      `SELECT e.*, u.display_name AS created_by_name FROM payroll_events e
       JOIN users u ON u.id=e.created_by WHERE e.batch_id=? ORDER BY e.created_at`
    )
    .all(payload.id) as any[];
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

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function exportPayroll(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "finance"))
    return { ok: false, message: "无权限", code: 403 };
  const batch = db
    .prepare(`SELECT * FROM payroll_batches WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!batch) return { ok: false, message: "工资批次不存在" };
  const items = db
    .prepare(
      `SELECT i.*, u.display_name, s.name AS store_name FROM payroll_items i
       JOIN users u ON u.id=i.user_id JOIN stores s ON s.id=i.store_id
       WHERE i.batch_id=? ORDER BY u.display_name`
    )
    .all(batch.id) as any[];
  const headers = [
    "月份",
    "门店",
    "员工",
    "基本工资",
    "津贴",
    "奖金",
    "扣款",
    "税额",
    "应发",
    "实发",
    "调整原因",
  ];
  const content = `\uFEFF${[
    headers.map(csvCell).join(","),
    ...items.map((item) =>
      [
        batch.payroll_month,
        item.store_name,
        item.display_name,
        item.base_salary,
        item.allowance,
        item.bonus,
        item.deduction,
        item.tax,
        item.gross_amount,
        item.net_amount,
        item.adjustment_reason,
      ]
        .map(csvCell)
        .join(",")
    ),
  ].join("\r\n")}`;
  writeAudit(db, user, "payroll.export", "payroll_batch", batch.id, {
    rows: items.length,
  });
  return {
    ok: true,
    data: {
      filename: `工资明细-${batch.payroll_month}.csv`,
      mime: "text/csv;charset=utf-8",
      content,
      rows: items.length,
    },
  };
}
