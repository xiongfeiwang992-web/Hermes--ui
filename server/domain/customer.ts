import type { Db } from "../db/database";
import { canWriteListing, customerVisibleTo, maskPhone } from "../auth/policy";
import { buildModificationSummary, recordModificationFollow } from "./activity";
import { writeAudit } from "./audit";
import {
  isAllowedCustomerSource,
  labelCustomerSource,
  normalizeCustomerSource,
} from "./config";
import { resolvePhoneVisibility } from "./contactGate";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function presentCustomer(db: Db, user: SessionUser, row: any) {
  const policyAllows =
    user.role === "admin" ||
    user.role === "store_manager" ||
    user.id === row.agent_id;
  const gate = resolvePhoneVisibility(db, user, policyAllows, "customer", row.id);
  return {
    ...row,
    phone: gate.showFull ? row.phone : maskPhone(row.phone),
    phone_masked: !gate.showFull,
    force_follow_required: gate.forceFollowRequired,
    source_label: labelCustomerSource(db, user.company_id, row.source),
  };
}

export function listCustomers(db: Db, user: SessionUser, q: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(`SELECT * FROM customers WHERE company_id = ? ORDER BY updated_at DESC`)
    .all(user.company_id) as any[];
  rows = rows.filter((c) => !c.merged_into_id);
  rows = rows.filter((c) => customerVisibleTo(user, c));
  if (q.intent) rows = rows.filter((c) => c.intent === q.intent);
  if (q.level) rows = rows.filter((c) => c.level === q.level);
  if (q.visibility) rows = rows.filter((c) => c.visibility === q.visibility);
  if (q.status) rows = rows.filter((c) => c.status === q.status);
  if (q.agent_id) rows = rows.filter((c) => c.agent_id === q.agent_id);
  if (q.source) {
    const source = normalizeCustomerSource(q.source);
    rows = rows.filter((c) => normalizeCustomerSource(c.source) === source);
  }
  if (q.keyword) {
    const k = String(q.keyword);
    rows = rows.filter((c) => c.name.includes(k) || c.phone.includes(k) || (c.need || "").includes(k));
  }
  return { ok: true, data: rows.map((r) => presentCustomer(db, user, r)) };
}

export function getCustomer(db: Db, user: SessionUser, id: string): ApiResult {
  const row = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(id, user.company_id) as any;
  if (!row || !customerVisibleTo(user, row)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  return { ok: true, data: presentCustomer(db, user, row) };
}

export function createCustomer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  if (!payload.name || !payload.phone || !payload.intent) {
    return { ok: false, message: "姓名/电话/意图必填" };
  }
  if (!["buy", "rent"].includes(payload.intent)) {
    return { ok: false, message: "intent 无效" };
  }
  const source = normalizeCustomerSource(payload.source);
  if (source && !isAllowedCustomerSource(db, user.company_id, source)) {
    return { ok: false, message: "客户来源不在当前字典中" };
  }
  const dup = db
    .prepare(`SELECT id, name FROM customers WHERE company_id = ? AND phone = ?`)
    .get(user.company_id, payload.phone) as any;
  const id = nextId("C");
  const now = nowIso();
  db.prepare(
    `INSERT INTO customers(
      id, company_id, store_id, name, phone, intent, budget_min, budget_max, budget_note,
      need, level, visibility, status, agent_id, source, remark, is_confidential, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'private', 'new', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    payload.name,
    payload.phone,
    payload.intent,
    payload.budget_min ?? null,
    payload.budget_max ?? null,
    payload.budget_note || null,
    payload.need || null,
    payload.level || "B",
    user.id,
    source,
    payload.remark || null,
    payload.is_confidential ? 1 : 0,
    now,
    now
  );
  writeAudit(db, user, "customer.create", "customer", id);
  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND status='active'
       AND (role='admin' OR (role='store_manager' AND store_id=?))`
    )
    .all(user.company_id, user.store_id) as any[];
  for (const manager of managers) {
    if (manager.id === user.id) continue;
    createMessage(db, {
      company_id: user.company_id,
      store_id: user.store_id,
      user_id: manager.id,
      title: "新客源已登记",
      body: `${payload.name} · ${user.display_name}`,
      kind: "customer_create",
      ref_type: "customer",
      ref_id: id,
    });
  }
  const created = getCustomer(db, user, id);
  if (created.ok && dup) {
    return {
      ok: true,
      data: {
        ...(created.data as object),
        duplicate_hint: { id: dup.id, name: dup.name },
      },
    };
  }
  return created;
}

export function updateCustomer(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current || !customerVisibleTo(user, current)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  if (user.role === "agent" && current.agent_id !== user.id && current.visibility !== "public") {
    return { ok: false, message: "只能编辑本人私客", code: 403 };
  }
  const nextConfidential =
    payload.is_confidential == null ? null : payload.is_confidential ? 1 : 0;
  const sourceProvided = Object.prototype.hasOwnProperty.call(payload, "source");
  const nextSource = sourceProvided ? normalizeCustomerSource(payload.source) : null;
  if (sourceProvided && nextSource && !isAllowedCustomerSource(db, user.company_id, nextSource)) {
    return { ok: false, message: "客户来源不在当前字典中" };
  }
  const summary = buildModificationSummary([
    { label: "姓名", provided: payload.name != null, prev: current.name, next: payload.name },
    {
      label: "电话",
      provided: payload.phone != null,
      prev: current.phone,
      next: payload.phone,
      sensitive: true,
    },
    { label: "意图", provided: payload.intent != null, prev: current.intent, next: payload.intent },
    {
      label: "预算下限",
      provided: payload.budget_min != null,
      prev: current.budget_min,
      next: payload.budget_min,
    },
    {
      label: "预算上限",
      provided: payload.budget_max != null,
      prev: current.budget_max,
      next: payload.budget_max,
    },
    {
      label: "预算说明",
      provided: payload.budget_note != null,
      prev: current.budget_note,
      next: payload.budget_note,
    },
    { label: "需求", provided: payload.need != null, prev: current.need, next: payload.need },
    { label: "等级", provided: payload.level != null, prev: current.level, next: payload.level },
    {
      label: "来源",
      provided: sourceProvided,
      prev: current.source,
      next: nextSource,
    },
    { label: "备注", provided: payload.remark != null, prev: current.remark, next: payload.remark },
    {
      label: "保密客",
      provided: payload.is_confidential != null,
      prev: current.is_confidential,
      next: nextConfidential,
      bool: true,
    },
  ]);
  db.prepare(
    `UPDATE customers SET
      name = COALESCE(?, name),
      phone = COALESCE(?, phone),
      intent = COALESCE(?, intent),
      budget_min = COALESCE(?, budget_min),
      budget_max = COALESCE(?, budget_max),
      budget_note = COALESCE(?, budget_note),
      need = COALESCE(?, need),
      level = COALESCE(?, level),
      source = COALESCE(?, source),
      remark = COALESCE(?, remark),
      is_confidential = COALESCE(?, is_confidential),
      updated_at = ?
     WHERE id = ?`
  ).run(
    payload.name ?? null,
    payload.phone ?? null,
    payload.intent ?? null,
    payload.budget_min ?? null,
    payload.budget_max ?? null,
    payload.budget_note ?? null,
    payload.need ?? null,
    payload.level ?? null,
    sourceProvided ? nextSource : null,
    payload.remark ?? null,
    nextConfidential,
    nowIso(),
    payload.id
  );
  writeAudit(db, user, "customer.update", "customer", payload.id);
  if (summary) {
    recordModificationFollow(db, user, {
      targetType: "customer",
      targetId: payload.id,
      summary,
    });
  }
  return getCustomer(db, user, payload.id);
}

export function toPublic(
  db: Db,
  user: SessionUser,
  payload: { id: string; reason?: string }
): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current || !customerVisibleTo(user, current)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  if (user.role === "agent" && current.agent_id !== user.id) {
    return { ok: false, message: "只能转本人私客", code: 403 };
  }
  db.prepare(
    `UPDATE customers SET visibility = 'public', status = 'public_pool', remark = COALESCE(?, remark), updated_at = ? WHERE id = ?`
  ).run(payload.reason || current.remark, nowIso(), payload.id);
  writeAudit(db, user, "customer.to_public", "customer", payload.id, {
    reason: payload.reason,
  });
  return getCustomer(db, user, payload.id);
}

export function claimCustomer(db: Db, user: SessionUser, payload: { id: string }): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const current = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!current) return { ok: false, message: "客源不存在" };
  if (current.store_id !== user.store_id && user.role !== "admin") {
    return { ok: false, message: "只能认领本店公客", code: 403 };
  }
  if (current.visibility !== "public") {
    return { ok: false, message: "仅公客可认领" };
  }
  db.prepare(
    `UPDATE customers SET visibility = 'private', agent_id = ?, store_id = ?, status = 'following', updated_at = ? WHERE id = ?`
  ).run(user.id, user.store_id, nowIso(), payload.id);
  writeAudit(db, user, "customer.claim", "customer", payload.id);
  return getCustomer(db, user, payload.id);
}

export function matchHouses(
  db: Db,
  user: SessionUser,
  payload: { id: string }
): ApiResult {
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!customer || !customerVisibleTo(user, customer)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  const dealType = customer.intent === "buy" ? "sale" : "rent";
  let rows = db
    .prepare(
      `SELECT * FROM houses
       WHERE company_id = ? AND store_id = ? AND deal_type = ? AND status = 'available'
       ORDER BY updated_at DESC`
    )
    .all(user.company_id, customer.store_id, dealType) as any[];
  rows = rows.filter((house) => {
    if (house.is_private && user.role === "agent" && house.agent_id !== user.id) {
      return false;
    }
    if (customer.budget_min != null && house.price < customer.budget_min) return false;
    if (customer.budget_max != null && house.price > customer.budget_max) return false;
    return true;
  });
  return {
    ok: true,
    data: rows.map((house) => ({
      id: house.id,
      title: house.title,
      community: house.community,
      price: house.price,
      price_unit: house.price_unit,
      area_size: house.area_size,
      rooms: house.rooms,
      district: house.district,
      match_reasons: [
        dealType === "sale" ? "求购类型匹配" : "求租类型匹配",
        customer.budget_min != null || customer.budget_max != null
          ? "预算范围匹配"
          : "未限定预算",
      ],
    })),
  };
}

export function listContacts(
  db: Db,
  user: SessionUser,
  payload: { customer_id: string }
): ApiResult {
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.customer_id, user.company_id) as any;
  if (!customer || !customerVisibleTo(user, customer)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  const rows = db
    .prepare(
      `SELECT * FROM customer_contacts
       WHERE company_id = ? AND customer_id = ?
       ORDER BY is_primary DESC, created_at`
    )
    .all(user.company_id, customer.id);
  return { ok: true, data: rows };
}

export function upsertContact(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const customer = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.customer_id, user.company_id) as any;
  if (!customer || !customerVisibleTo(user, customer)) {
    return { ok: false, message: "客源不存在或无权限", code: 403 };
  }
  if (user.role === "agent" && customer.agent_id !== user.id) {
    return { ok: false, message: "只能维护本人客户联系人", code: 403 };
  }
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  if (!name || !phone) return { ok: false, message: "联系人姓名和电话必填" };
  const now = nowIso();
  if (payload.is_primary) {
    db.prepare(
      `UPDATE customer_contacts SET is_primary = 0, updated_at = ?
       WHERE company_id = ? AND customer_id = ?`
    ).run(now, user.company_id, customer.id);
  }
  if (payload.id) {
    const result = db.prepare(
      `UPDATE customer_contacts SET name = ?, phone = ?, relation = ?,
       is_primary = ?, remark = ?, updated_at = ?
       WHERE id = ? AND company_id = ? AND customer_id = ?`
    ).run(
      name,
      phone,
      payload.relation || null,
      payload.is_primary ? 1 : 0,
      payload.remark || null,
      now,
      payload.id,
      user.company_id,
      customer.id
    );
    if (!result.changes) return { ok: false, message: "联系人不存在" };
    writeAudit(db, user, "customer_contact.update", "customer_contact", payload.id);
    return { ok: true, data: { id: payload.id } };
  }
  const id = nextId("CON");
  db.prepare(
    `INSERT INTO customer_contacts(
      id, company_id, store_id, customer_id, name, phone, relation,
      is_primary, remark, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    customer.store_id,
    customer.id,
    name,
    phone,
    payload.relation || null,
    payload.is_primary ? 1 : 0,
    payload.remark || null,
    user.id,
    now,
    now
  );
  writeAudit(db, user, "customer_contact.create", "customer_contact", id, {
    customer_id: customer.id,
  });
  return { ok: true, data: { id } };
}

export function mergeCustomers(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  if (!payload.source_id || !payload.target_id || payload.source_id === payload.target_id) {
    return { ok: false, message: "源客源与目标客源须不同" };
  }
  const source = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.source_id, user.company_id) as any;
  const target = db
    .prepare(`SELECT * FROM customers WHERE id = ? AND company_id = ?`)
    .get(payload.target_id, user.company_id) as any;
  if (!source || !target || source.merged_into_id || target.merged_into_id) {
    return { ok: false, message: "客源不存在或已合并" };
  }
  if (source.store_id !== target.store_id) {
    return { ok: false, message: "不可跨店合并客源" };
  }
  if (user.role === "store_manager" && source.store_id !== user.store_id) {
    return { ok: false, message: "只能合并本店客源", code: 403 };
  }
  const now = nowIso();
  const mergeId = nextId("MRG");
  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE follows SET target_id = ?
       WHERE company_id = ? AND target_type = 'customer' AND target_id = ?`
    ).run(target.id, user.company_id, source.id);
    db.prepare(`UPDATE views SET customer_id = ? WHERE company_id = ? AND customer_id = ?`).run(
      target.id,
      user.company_id,
      source.id
    );
    db.prepare(`UPDATE deals SET customer_id = ? WHERE company_id = ? AND customer_id = ?`).run(
      target.id,
      user.company_id,
      source.id
    );
    db.prepare(
      `UPDATE earnest_moneys SET customer_id = ?
       WHERE company_id = ? AND customer_id = ?`
    ).run(target.id, user.company_id, source.id);
    db.prepare(
      `UPDATE customer_contacts SET customer_id = ?, store_id = ?, updated_at = ?
       WHERE company_id = ? AND customer_id = ?`
    ).run(target.id, target.store_id, now, user.company_id, source.id);
    db.prepare(
      `UPDATE customers SET status = 'invalid', merged_into_id = ?, merged_at = ?,
       remark = ?, updated_at = ? WHERE id = ?`
    ).run(
      target.id,
      now,
      [source.remark, `已合并至 ${target.id}`].filter(Boolean).join("；"),
      now,
      source.id
    );
    db.prepare(
      `INSERT INTO customer_merge_logs(
        id, company_id, store_id, source_customer_id, target_customer_id,
        merged_by, detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      mergeId,
      user.company_id,
      source.store_id,
      source.id,
      target.id,
      user.id,
      payload.reason || null,
      now
    );
  });
  transaction();
  writeAudit(db, user, "customer.merge", "customer", target.id, {
    source_id: source.id,
    reason: payload.reason,
  });
  return { ok: true, data: { id: target.id, merged_source_id: source.id } };
}

export function getPublicPoolSettings(db: Db, user: SessionUser): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  const row = db
    .prepare(`SELECT public_pool_days FROM settings WHERE company_id = ?`)
    .get(user.company_id) as any;
  return {
    ok: true,
    data: {
      public_pool_days: Number(row?.public_pool_days || 0),
      enabled: Number(row?.public_pool_days || 0) > 0,
    },
  };
}

export function updatePublicPoolSettings(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const days = Number(payload.public_pool_days);
  if (!Number.isInteger(days) || days < 0 || days > 365) {
    return { ok: false, message: "掉公天数须为 0～365 的整数" };
  }
  db.prepare(
    `UPDATE settings SET public_pool_days = ?, updated_by = ?, updated_at = ?
     WHERE company_id = ?`
  ).run(days, user.id, nowIso(), user.company_id);
  writeAudit(db, user, "public_pool.settings", "settings", user.company_id, {
    public_pool_days: days,
  });
  return { ok: true, data: { public_pool_days: days, enabled: days > 0 } };
}

export function runPublicPool(db: Db, user: SessionUser): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  const setting = db
    .prepare(`SELECT public_pool_days FROM settings WHERE company_id = ?`)
    .get(user.company_id) as any;
  const days = Number(setting?.public_pool_days || 0);
  if (days <= 0) {
    return { ok: true, data: { moved: 0, enabled: false } };
  }
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  let customers = db
    .prepare(
      `SELECT c.*,
       COALESCE(
         (SELECT MAX(f.created_at) FROM follows f
          WHERE f.company_id = c.company_id AND f.target_type = 'customer'
          AND f.target_id = c.id AND f.voided = 0),
         c.created_at
       ) AS last_activity_at
       FROM customers c
       WHERE c.company_id = ? AND c.visibility = 'private'
       AND c.status NOT IN ('closed', 'invalid') AND c.merged_into_id IS NULL`
    )
    .all(user.company_id) as any[];
  if (user.role === "store_manager") {
    customers = customers.filter((customer) => customer.store_id === user.store_id);
  }
  customers = customers.filter((customer) => customer.last_activity_at < cutoff);
  const now = nowIso();
  const transaction = db.transaction(() => {
    for (const customer of customers) {
      db.prepare(
        `UPDATE customers SET visibility = 'public', status = 'public_pool',
         updated_at = ? WHERE id = ?`
      ).run(now, customer.id);
      createMessage(db, {
        company_id: user.company_id,
        store_id: customer.store_id,
        user_id: customer.agent_id,
        title: "私客已自动掉公",
        body: `${customer.name} 因 ${days} 天未跟进已转入公客池`,
        kind: "customer_public_pool",
        ref_type: "customer",
        ref_id: customer.id,
      });
    }
  });
  transaction();
  writeAudit(db, user, "public_pool.run", "customer", undefined, {
    days,
    moved: customers.length,
  });
  return { ok: true, data: { moved: customers.length, enabled: true } };
}
