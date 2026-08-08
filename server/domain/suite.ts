import { createHash } from "node:crypto";
import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, Role, SessionUser } from "../utils/types";

const TYPES: Record<string, Set<string>> = {
  property_ext: new Set([
    "listing_lock",
    "cooperation",
    "media",
    "auction",
    "exclusive_agency",
  ]),
  deal_ext: new Set(["deal_complaint", "rename"]),
  newhome: new Set([
    "distribution_company",
    "sales_report",
  ]),
  finance: new Set(["asset", "voucher"]),
  office: new Set([
    "exam",
    "event",
    "workflow",
    "ticket",
    "work_summary",
    "circle_post",
    "call_record",
  ]),
  marketing: new Set(["website_page", "online_entrustment", "lead", "campaign"]),
  rental: new Set(["managed_property", "lease", "bill", "maintenance", "cleaning"]),
  customer_care: new Set(["complaint", "lawsuit", "survey", "callback"]),
  performance: new Set(["points", "bonus", "dividend", "target"]),
};

const MANAGER_ONLY = new Set([
  "finance",
  "customer_care",
  "performance",
  "marketing",
]);

const TRANSITIONS: Record<string, string[]> = {
  draft: ["pending", "active", "cancelled"],
  pending: ["approved", "rejected", "cancelled"],
  rejected: ["draft", "cancelled"],
  approved: ["in_progress", "completed", "active", "cancelled"],
  active: ["in_progress", "completed", "inactive", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  inactive: ["active"],
};

function canCreate(user: SessionUser, module: string): boolean {
  if (user.role === "admin") return true;
  if (module === "finance") return user.role === "finance";
  if (module === "hr" || module === "performance") return user.role === "store_manager";
  if (MANAGER_ONLY.has(module)) return user.role === "store_manager";
  return user.role !== "finance";
}

function visible(user: SessionUser, row: any): boolean {
  if (user.role === "admin") return true;
  if (user.role === "finance") return row.module === "finance" || row.module === "performance";
  if (row.store_id && row.store_id !== user.store_id) return false;
  if (user.role === "store_manager") return true;
  if (row.module === "office" && row.record_type === "event") {
    return row.status === "active" || row.status === "approved" || row.created_by === user.id;
  }
  return (
    row.created_by === user.id ||
    row.owner_user_id === user.id ||
    row.assignee_user_id === user.id
  );
}

function present(row: any) {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data_json || "{}");
  } catch {
    data = {};
  }
  return { ...row, data };
}

export function modules(): ApiResult {
  return {
    ok: true,
    data: Object.entries(TYPES).map(([module, types]) => ({
      module,
      types: [...types],
    })),
  };
}

export function listRecords(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (payload.module && !TYPES[payload.module]) {
    return { ok: false, message: "模块无效" };
  }
  let rows = db
    .prepare(`SELECT * FROM business_records WHERE company_id = ? ORDER BY updated_at DESC`)
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row));
  if (payload.module) rows = rows.filter((row) => row.module === payload.module);
  if (payload.record_type) rows = rows.filter((row) => row.record_type === payload.record_type);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.parent_type) rows = rows.filter((row) => row.parent_type === payload.parent_type);
  if (payload.parent_id) rows = rows.filter((row) => row.parent_id === payload.parent_id);
  return { ok: true, data: rows.map(present) };
}

export function createRecord(db: Db, user: SessionUser, payload: any): ApiResult {
  const allowedTypes = TYPES[payload.module];
  if (!allowedTypes || !allowedTypes.has(payload.record_type)) {
    return { ok: false, message: "模块或记录类型无效" };
  }
  if (!canCreate(user, payload.module)) {
    return { ok: false, message: "无权限", code: 403 };
  }
  const title = String(payload.title || "").trim();
  if (!title) return { ok: false, message: "标题必填" };
  const id = nextId("BR");
  const now = nowIso();
  const storeId =
    user.role === "admin" && payload.store_id ? payload.store_id : user.store_id;
  db.prepare(
    `INSERT INTO business_records(
      id, company_id, store_id, module, record_type, title, status,
      owner_user_id, assignee_user_id, amount, start_at, due_at,
      parent_type, parent_id, data_json, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    payload.company_wide ? null : storeId,
    payload.module,
    payload.record_type,
    title,
    payload.status || "draft",
    payload.owner_user_id || user.id,
    payload.assignee_user_id || null,
    payload.amount == null ? null : Number(payload.amount),
    payload.start_at || null,
    payload.due_at || null,
    payload.parent_type || null,
    payload.parent_id || null,
    JSON.stringify(payload.data || {}),
    user.id,
    now,
    now
  );
  writeAudit(db, user, `${payload.module}.${payload.record_type}.create`, "business_record", id);
  return { ok: true, data: { id } };
}

export function updateRecord(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM business_records WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !visible(user, row)) {
    return { ok: false, message: "记录不存在或无权限", code: 403 };
  }
  const canEdit =
    user.role === "admin" ||
    (user.role === "finance" && row.module === "finance") ||
    (user.role === "store_manager" && row.store_id === user.store_id) ||
    (row.created_by === user.id && ["draft", "rejected"].includes(row.status));
  if (!canEdit) return { ok: false, message: "当前记录不可编辑", code: 403 };
  const currentData = present(row).data;
  db.prepare(
    `UPDATE business_records SET title = COALESCE(?, title),
     assignee_user_id = COALESCE(?, assignee_user_id),
     amount = COALESCE(?, amount), start_at = COALESCE(?, start_at),
     due_at = COALESCE(?, due_at), data_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    payload.title ?? null,
    payload.assignee_user_id ?? null,
    payload.amount == null ? null : Number(payload.amount),
    payload.start_at ?? null,
    payload.due_at ?? null,
    JSON.stringify({ ...currentData, ...(payload.data || {}) }),
    nowIso(),
    row.id
  );
  writeAudit(db, user, `${row.module}.${row.record_type}.update`, "business_record", row.id);
  return { ok: true, data: { id: row.id } };
}

export function changeStatus(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM business_records WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !visible(user, row)) {
    return { ok: false, message: "记录不存在或无权限", code: 403 };
  }
  if (!(TRANSITIONS[row.status] || []).includes(payload.status)) {
    return { ok: false, message: `不能从 ${row.status} 变更为 ${payload.status}` };
  }
  const approval = ["approved", "rejected"].includes(payload.status);
  if (
    approval &&
    !(
      user.role === "admin" ||
      (user.role === "store_manager" && row.store_id === user.store_id) ||
      (user.role === "finance" && row.module === "finance")
    )
  ) {
    return { ok: false, message: "无审批权限", code: 403 };
  }
  if (payload.status === "rejected" && !String(payload.reason || "").trim()) {
    return { ok: false, message: "驳回原因必填" };
  }
  const now = nowIso();
  db.prepare(
    `UPDATE business_records SET status = ?, completed_at = ?,
     approved_by = ?, approved_at = ?, reject_reason = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    payload.status,
    payload.status === "completed" ? now : null,
    approval ? user.id : row.approved_by,
    approval ? now : row.approved_at,
    payload.status === "rejected" ? payload.reason : null,
    now,
    row.id
  );
  if (row.created_by !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.created_by,
      title: `${row.title} 状态更新`,
      body: `${row.status} → ${payload.status}${payload.reason ? `：${payload.reason}` : ""}`,
      kind: "business_record_status",
      ref_type: "business_record",
      ref_id: row.id,
    });
  }
  writeAudit(db, user, `${row.module}.${row.record_type}.status`, "business_record", row.id, {
    from: row.status,
    to: payload.status,
    reason: payload.reason,
  });
  return { ok: true, data: { id: row.id, status: payload.status } };
}

export function listBlacklists(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  let rows = db
    .prepare(
      `SELECT * FROM blacklists WHERE company_id = ? AND status = 'active'
       ORDER BY created_at DESC`
    )
    .all(user.company_id) as any[];
  if (payload.kind) rows = rows.filter((row) => row.kind === payload.kind);
  return { ok: true, data: rows };
}

export function addBlacklist(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  if (!["phone", "id_card", "lead"].includes(payload.kind)) {
    return { ok: false, message: "黑名单类型无效" };
  }
  const value = String(payload.value || "").trim();
  const reason = String(payload.reason || "").trim();
  if (!value || !reason) return { ok: false, message: "值和原因必填" };
  const hash = createHash("sha256").update(value).digest("hex");
  const display =
    value.length > 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : "***";
  const id = nextId("BL");
  const now = nowIso();
  try {
    db.prepare(
      `INSERT INTO blacklists(
        id, company_id, kind, value_hash, display_value, reason,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(id, user.company_id, payload.kind, hash, display, reason, user.id, now, now);
  } catch {
    return { ok: false, message: "该条目已在黑名单", code: 409 };
  }
  writeAudit(db, user, "blacklist.add", "blacklist", id, { kind: payload.kind });
  return { ok: true, data: { id } };
}

export function listPermissions(db: Db, user: SessionUser): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  return {
    ok: true,
    data: db
      .prepare(`SELECT * FROM feature_permissions WHERE company_id = ? ORDER BY role, feature`)
      .all(user.company_id),
  };
}

export function setPermission(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const roles: Role[] = ["admin", "store_manager", "agent", "finance"];
  if (!roles.includes(payload.role) || !String(payload.feature || "").trim()) {
    return { ok: false, message: "角色或功能无效" };
  }
  const existing = db
    .prepare(
      `SELECT id FROM feature_permissions WHERE company_id = ? AND role = ? AND feature = ?`
    )
    .get(user.company_id, payload.role, payload.feature) as any;
  const now = nowIso();
  if (existing) {
    db.prepare(
      `UPDATE feature_permissions SET allowed = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).run(payload.allowed ? 1 : 0, user.id, now, existing.id);
    return { ok: true, data: { id: existing.id } };
  }
  const id = nextId("PERM");
  db.prepare(
    `INSERT INTO feature_permissions(
      id, company_id, role, feature, allowed, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, user.company_id, payload.role, payload.feature, payload.allowed ? 1 : 0, user.id, now);
  writeAudit(db, user, "permission.set", "feature_permission", id, payload);
  return { ok: true, data: { id } };
}

export function featureAllowed(db: Db, user: SessionUser, action: string): boolean {
  if (user.role === "admin" || action.startsWith("auth.")) return true;
  const exact = db
    .prepare(
      `SELECT allowed FROM feature_permissions
       WHERE company_id = ? AND role = ? AND feature = ?`
    )
    .get(user.company_id, user.role, action) as any;
  if (exact) return Boolean(exact.allowed);
  const domain = action.split(".")[0];
  const broad = db
    .prepare(
      `SELECT allowed FROM feature_permissions
       WHERE company_id = ? AND role = ? AND feature = ?`
    )
    .get(user.company_id, user.role, `${domain}.*`) as any;
  return broad ? Boolean(broad.allowed) : true;
}

export function listIntegrations(db: Db, user: SessionUser): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const providers = [
    "ca_esign",
    "virtual_number",
    "external_listing",
    "map",
    "wechat",
    "sms",
  ];
  const configured = db
    .prepare(`SELECT * FROM integration_configs WHERE company_id = ?`)
    .all(user.company_id) as any[];
  return {
    ok: true,
    data: providers.map(
      (provider) =>
        configured.find((row) => row.provider === provider) || {
          provider,
          enabled: 0,
          mode: "adapter_only",
          health_status: "not_configured",
        }
    ),
  };
}

export function configureIntegration(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const allowed = new Set([
    "ca_esign",
    "virtual_number",
    "external_listing",
    "map",
    "wechat",
    "sms",
  ]);
  if (!allowed.has(payload.provider)) return { ok: false, message: "适配器无效" };
  if (payload.enabled && !String(payload.endpoint || "").startsWith("https://")) {
    return { ok: false, message: "启用适配器须配置 HTTPS 地址" };
  }
  const current = db
    .prepare(
      `SELECT id FROM integration_configs WHERE company_id = ? AND provider = ?`
    )
    .get(user.company_id, payload.provider) as any;
  const now = nowIso();
  const safeConfig = {
    credential_ref: payload.credential_ref || null,
    tenant_ref: payload.tenant_ref || null,
  };
  if (current) {
    db.prepare(
      `UPDATE integration_configs SET enabled = ?, endpoint = ?, config_json = ?,
       health_status = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).run(
      payload.enabled ? 1 : 0,
      payload.endpoint || null,
      JSON.stringify(safeConfig),
      payload.enabled ? "configured_not_tested" : "disabled",
      user.id,
      now,
      current.id
    );
    return { ok: true, data: { id: current.id } };
  }
  const id = nextId("INT");
  db.prepare(
    `INSERT INTO integration_configs(
      id, company_id, provider, enabled, mode, endpoint, config_json,
      health_status, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, 'adapter_only', ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    payload.provider,
    payload.enabled ? 1 : 0,
    payload.endpoint || null,
    JSON.stringify(safeConfig),
    payload.enabled ? "configured_not_tested" : "disabled",
    user.id,
    now
  );
  writeAudit(db, user, "integration.configure", "integration", id, {
    provider: payload.provider,
    enabled: Boolean(payload.enabled),
  });
  return { ok: true, data: { id } };
}
