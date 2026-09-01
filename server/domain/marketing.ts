import { createHash } from "node:crypto";
import type { Db } from "../db/database";
import { maskPhone } from "../auth/policy";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const CHANNELS = new Set([
  "website",
  "wechat",
  "douyin",
  "referral",
  "walk_in",
  "phone",
  "campaign",
  "other",
]);
const INTENTS = new Set(["buy", "rent", "sell", "entrust"]);
const ENTRUST_TYPES = new Set(["sell", "rent", "buy"]);
const LEAD_TRANSITIONS: Record<string, string[]> = {
  new: ["contacting", "lost", "invalid"],
  contacting: ["qualified", "lost", "invalid"],
  qualified: ["converted", "lost"],
  converted: [],
  lost: [],
  invalid: [],
};

function canManage(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "store_manager";
}

function leadVisible(user: SessionUser, row: any): boolean {
  if (user.role === "finance") return false;
  if (user.role === "admin") return true;
  if (user.store_id !== row.store_id) return false;
  if (user.role === "store_manager") return true;
  return row.assignee_user_id === user.id || row.created_by === user.id;
}

function campaignVisible(user: SessionUser, row: any): boolean {
  if (user.role === "finance") return false;
  if (user.role === "admin") return true;
  if (!row.store_id || row.store_id === user.store_id) return true;
  return false;
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
    `INSERT INTO marketing_events(
      id, company_id, entity_type, entity_id, event_type, details, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nextId("MKE"),
    user.company_id,
    entityType,
    entityId,
    eventType,
    JSON.stringify(details),
    user.id,
    nowIso()
  );
}

function phoneBlocked(db: Db, companyId: string, phone: string): boolean {
  const hash = createHash("sha256").update(phone).digest("hex");
  return Boolean(
    db
      .prepare(
        `SELECT id FROM blacklists WHERE company_id=? AND status='active'
         AND kind IN ('phone', 'lead') AND value_hash=?`
      )
      .get(companyId, hash)
  );
}

function presentLead(user: SessionUser, row: any) {
  const canSeePhone =
    user.role === "admin" ||
    (user.role === "store_manager" && user.store_id === row.store_id) ||
    row.assignee_user_id === user.id ||
    row.created_by === user.id;
  return {
    ...row,
    contact_phone: canSeePhone ? row.contact_phone : maskPhone(row.contact_phone),
  };
}

export function marketingOptions(db: Db, user: SessionUser): ApiResult {
  if (user.role === "finance")
    return { ok: true, data: { stores: [], users: [], campaigns: [] } };
  let stores = db
    .prepare(`SELECT id, name FROM stores WHERE company_id=? AND status='active' ORDER BY name`)
    .all(user.company_id) as any[];
  let users = db
    .prepare(
      `SELECT id, store_id, display_name, role FROM users
       WHERE company_id=? AND status='active' AND role IN ('agent', 'store_manager')
       ORDER BY display_name`
    )
    .all(user.company_id) as any[];
  let campaigns = db
    .prepare(
      `SELECT id, store_id, name, channel, status FROM marketing_campaigns
       WHERE company_id=? AND status='active' ORDER BY start_date DESC`
    )
    .all(user.company_id) as any[];
  if (user.role !== "admin") {
    stores = stores.filter((store) => store.id === user.store_id);
    users = users.filter((row) => row.store_id === user.store_id);
    campaigns = campaigns.filter((row) => !row.store_id || row.store_id === user.store_id);
  }
  return { ok: true, data: { stores, users, campaigns } };
}

export function listCampaigns(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: true, data: [] };
  let rows = db
    .prepare(
      `SELECT c.*, s.name AS store_name, creator.display_name AS creator_name,
       (SELECT COUNT(*) FROM marketing_leads l WHERE l.campaign_id=c.id) AS lead_count
       FROM marketing_campaigns c
       LEFT JOIN stores s ON s.id=c.store_id
       JOIN users creator ON creator.id=c.created_by
       WHERE c.company_id=? ORDER BY c.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => campaignVisible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function createCampaign(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无营销活动创建权限", code: 403 };
  const name = String(payload.name || "").trim();
  if (!name) return { ok: false, message: "活动名称必填" };
  if (!CHANNELS.has(payload.channel)) return { ok: false, message: "活动渠道无效" };
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.start_date || "")) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.end_date || "")) ||
    payload.end_date < payload.start_date
  )
    return { ok: false, message: "活动日期无效" };
  const budget = Number(payload.budget || 0);
  if (!Number.isFinite(budget) || budget < 0) return { ok: false, message: "活动预算无效" };
  let storeId: string | null = null;
  if (user.role === "store_manager") storeId = user.store_id;
  else if (payload.store_id) {
    const store = db
      .prepare(`SELECT id FROM stores WHERE id=? AND company_id=? AND status='active'`)
      .get(payload.store_id, user.company_id);
    if (!store) return { ok: false, message: "活动门店无效" };
    storeId = payload.store_id;
  }
  const id = nextId("MKC");
  const now = nowIso();
  db.prepare(
    `INSERT INTO marketing_campaigns(
      id, company_id, store_id, name, channel, start_date, end_date,
      budget, status, remark, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    storeId,
    name,
    payload.channel,
    payload.start_date,
    payload.end_date,
    budget,
    String(payload.remark || "").trim() || null,
    user.id,
    now,
    now
  );
  addEvent(db, user, "campaign", id, "created");
  writeAudit(db, user, "marketing.campaign.create", "marketing_campaign", id);
  const recipients = new Set<string>();
  const admins = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND status='active' AND role='admin'`
    )
    .all(user.company_id) as { id: string }[];
  for (const admin of admins) recipients.add(admin.id);
  if (storeId) {
    const managers = db
      .prepare(
        `SELECT id FROM users WHERE company_id=? AND store_id=? AND status='active'
         AND role='store_manager'`
      )
      .all(user.company_id, storeId) as { id: string }[];
    for (const manager of managers) recipients.add(manager.id);
  } else {
    const managers = db
      .prepare(
        `SELECT id FROM users WHERE company_id=? AND status='active' AND role='store_manager'`
      )
      .all(user.company_id) as { id: string }[];
    for (const manager of managers) recipients.add(manager.id);
  }
  recipients.delete(user.id);
  for (const userId of recipients) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: storeId,
      user_id: userId,
      title: "营销活动已创建",
      body: `${name} · ${payload.channel}`,
      kind: "marketing",
      ref_type: "marketing_campaign",
      ref_id: id,
    });
  }
  return { ok: true, data: { id, status: "draft" } };
}

export function changeCampaignStatus(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  const row = db
    .prepare(`SELECT * FROM marketing_campaigns WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (
    !row ||
    !(
      user.role === "admin" ||
      (user.role === "store_manager" && (!row.store_id || row.store_id === user.store_id))
    )
  )
    return { ok: false, message: "活动不存在或无权限", code: 403 };
  if (payload.status === "active") {
    if (row.status !== "draft") return { ok: false, message: "仅草稿活动可启用" };
  } else if (payload.status === "closed") {
    if (!["draft", "active"].includes(row.status))
      return { ok: false, message: "当前活动不可关闭" };
  } else return { ok: false, message: "活动状态无效" };
  db.prepare(`UPDATE marketing_campaigns SET status=?, updated_at=? WHERE id=?`).run(
    payload.status,
    nowIso(),
    row.id
  );
  addEvent(db, user, "campaign", row.id, payload.status);
  writeAudit(db, user, `marketing.campaign.${payload.status}`, "marketing_campaign", row.id);
  return { ok: true, data: { id: row.id, status: payload.status } };
}

export function listLeads(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: true, data: [] };
  let rows = db
    .prepare(
      `SELECT l.*, s.name AS store_name, campaign.name AS campaign_name,
       assignee.display_name AS assignee_name, creator.display_name AS creator_name
       FROM marketing_leads l
       JOIN stores s ON s.id=l.store_id
       LEFT JOIN marketing_campaigns campaign ON campaign.id=l.campaign_id
       LEFT JOIN users assignee ON assignee.id=l.assignee_user_id
       JOIN users creator ON creator.id=l.created_by
       WHERE l.company_id=? ORDER BY l.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => leadVisible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.channel) rows = rows.filter((row) => row.channel === payload.channel);
  if (payload.campaign_id)
    rows = rows.filter((row) => row.campaign_id === payload.campaign_id);
  return { ok: true, data: rows.map((row) => presentLead(user, row)) };
}

export function createLead(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "财务无营销线索权限", code: 403 };
  const contactName = String(payload.contact_name || "").trim();
  const contactPhone = String(payload.contact_phone || "").replace(/\s/g, "");
  if (!contactName || !/^1\d{10}$/.test(contactPhone))
    return { ok: false, message: "联系人姓名或手机号无效" };
  if (!INTENTS.has(payload.intent)) return { ok: false, message: "线索意向无效" };
  if (!CHANNELS.has(payload.channel)) return { ok: false, message: "线索渠道无效" };
  if (phoneBlocked(db, user.company_id, contactPhone))
    return { ok: false, message: "该电话已在业务或商机黑名单中" };
  const openLead = db
    .prepare(
      `SELECT id FROM marketing_leads WHERE company_id=? AND contact_phone=?
       AND status IN ('new', 'contacting', 'qualified')`
    )
    .get(user.company_id, contactPhone);
  if (openLead) return { ok: false, message: "该公司已存在进行中的同号线索" };
  const existingCustomer = db
    .prepare(
      `SELECT id, name FROM customers WHERE company_id=? AND phone=?
       AND status NOT IN ('invalid', 'merged')`
    )
    .get(user.company_id, contactPhone) as any;
  let campaignId: string | null = null;
  if (payload.campaign_id) {
    const campaign = db
      .prepare(`SELECT * FROM marketing_campaigns WHERE id=? AND company_id=?`)
      .get(payload.campaign_id, user.company_id) as any;
    if (!campaign || campaign.status !== "active")
      return { ok: false, message: "关联活动不存在或未启用" };
    if (
      user.role === "store_manager" &&
      campaign.store_id &&
      campaign.store_id !== user.store_id
    )
      return { ok: false, message: "无权关联其他门店活动", code: 403 };
    campaignId = campaign.id;
  }
  let storeId = user.store_id;
  let assigneeId = user.role === "agent" ? user.id : payload.assignee_user_id || null;
  if (user.role === "admin" && payload.store_id) {
    const store = db
      .prepare(`SELECT id FROM stores WHERE id=? AND company_id=? AND status='active'`)
      .get(payload.store_id, user.company_id);
    if (!store) return { ok: false, message: "线索门店无效" };
    storeId = payload.store_id;
  }
  if (assigneeId) {
    const assignee = db
      .prepare(
        `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=?
         AND status='active' AND role IN ('agent', 'store_manager')`
      )
      .get(assigneeId, user.company_id, storeId);
    if (!assignee) return { ok: false, message: "负责人必须为同店在职经纪人/店长" };
  }
  const id = nextId("MKL");
  const now = nowIso();
  db.prepare(
    `INSERT INTO marketing_leads(
      id, company_id, store_id, campaign_id, contact_name, contact_phone,
      intent, channel, source_detail, need, budget_note, status,
      assignee_user_id, remark, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    storeId,
    campaignId,
    contactName,
    contactPhone,
    payload.intent,
    payload.channel,
    String(payload.source_detail || "").trim() || null,
    String(payload.need || "").trim() || null,
    String(payload.budget_note || "").trim() || null,
    assigneeId,
    String(payload.remark || "").trim() || null,
    user.id,
    now,
    now
  );
  addEvent(db, user, "lead", id, "created", {
    channel: payload.channel,
    existing_customer_id: existingCustomer?.id || null,
  });
  if (assigneeId && assigneeId !== user.id)
    createMessage(db, {
      company_id: user.company_id,
      store_id: storeId,
      user_id: assigneeId,
      title: "新营销线索已分配",
      body: `${contactName} · ${payload.channel}`,
      kind: "marketing",
      ref_type: "marketing_lead",
      ref_id: id,
    });
  writeAudit(db, user, "marketing.lead.create", "marketing_lead", id);
  return {
    ok: true,
    data: {
      id,
      status: "new",
      existing_customer_hint: existingCustomer
        ? { id: existingCustomer.id, name: existingCustomer.name }
        : null,
    },
  };
}

export function assignLead(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM marketing_leads WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !canManage(user) || (user.role === "store_manager" && row.store_id !== user.store_id))
    return { ok: false, message: "线索不存在或无分派权限", code: 403 };
  if (!["new", "contacting", "qualified"].includes(row.status))
    return { ok: false, message: "当前线索不可分派" };
  const assignee = db
    .prepare(
      `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=?
       AND status='active' AND role IN ('agent', 'store_manager')`
    )
    .get(payload.assignee_user_id, user.company_id, row.store_id);
  if (!assignee) return { ok: false, message: "负责人必须为同店在职经纪人/店长" };
  db.prepare(
    `UPDATE marketing_leads SET assignee_user_id=?, updated_at=? WHERE id=?`
  ).run(payload.assignee_user_id, nowIso(), row.id);
  addEvent(db, user, "lead", row.id, "assigned", {
    assignee_user_id: payload.assignee_user_id,
  });
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: payload.assignee_user_id,
    title: "营销线索已分派",
    body: row.contact_name,
    kind: "marketing",
    ref_type: "marketing_lead",
    ref_id: row.id,
  });
  writeAudit(db, user, "marketing.lead.assign", "marketing_lead", row.id);
  return { ok: true, data: { id: row.id, assignee_user_id: payload.assignee_user_id } };
}

export function changeLeadStatus(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM marketing_leads WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !leadVisible(user, row))
    return { ok: false, message: "线索不存在或无权限", code: 403 };
  const canOperate =
    canManage(user) ||
    row.assignee_user_id === user.id ||
    (row.created_by === user.id && !row.assignee_user_id);
  if (!canOperate) return { ok: false, message: "当前用户不可变更线索状态", code: 403 };
  const next = String(payload.status || "");
  if (!(LEAD_TRANSITIONS[row.status] || []).includes(next))
    return { ok: false, message: "线索状态流转无效" };
  if (["lost", "invalid"].includes(next)) {
    const reason = String(payload.reason || "").trim();
    if (!reason) return { ok: false, message: "流失或无效原因必填" };
    db.prepare(
      `UPDATE marketing_leads SET status=?, lost_reason=?, updated_at=? WHERE id=?`
    ).run(next, reason, nowIso(), row.id);
    addEvent(db, user, "lead", row.id, next, { reason });
  } else {
    db.prepare(`UPDATE marketing_leads SET status=?, updated_at=? WHERE id=?`).run(
      next,
      nowIso(),
      row.id
    );
    addEvent(db, user, "lead", row.id, next);
  }
  writeAudit(db, user, `marketing.lead.${next}`, "marketing_lead", row.id);
  return { ok: true, data: { id: row.id, status: next } };
}

export function convertLead(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM marketing_leads WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !leadVisible(user, row))
    return { ok: false, message: "线索不存在或无权限", code: 403 };
  const canOperate =
    canManage(user) || row.assignee_user_id === user.id;
  if (!canOperate) return { ok: false, message: "仅负责人或店长可转化线索", code: 403 };
  if (!["contacting", "qualified"].includes(row.status))
    return { ok: false, message: "仅跟进中或已确认线索可转客源" };
  if (!row.assignee_user_id)
    return { ok: false, message: "请先分派线索负责人" };
  if (phoneBlocked(db, user.company_id, row.contact_phone))
    return { ok: false, message: "该电话已在业务或商机黑名单中" };
  const existing = db
    .prepare(
      `SELECT id FROM customers WHERE company_id=? AND phone=?
       AND status NOT IN ('invalid', 'merged')`
    )
    .get(user.company_id, row.contact_phone);
  if (existing) return { ok: false, message: "该电话已存在客源，请勿重复转化" };
  const intent =
    row.intent === "buy" || row.intent === "rent" ? row.intent : payload.intent || "buy";
  if (!["buy", "rent"].includes(intent))
    return { ok: false, message: "转客源意向仅支持买卖或租赁" };
  const customerId = nextId("C");
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO customers(
        id, company_id, store_id, name, phone, intent, budget_min, budget_max,
        budget_note, need, level, visibility, status, agent_id, source, remark,
        is_confidential, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'B', 'private', 'new', ?, ?, ?, 0, ?, ?)`
    ).run(
      customerId,
      user.company_id,
      row.store_id,
      row.contact_name,
      row.contact_phone,
      intent,
      row.budget_note,
      row.need,
      row.assignee_user_id,
      `marketing:${row.channel}`,
      row.remark,
      now,
      now
    );
    db.prepare(
      `UPDATE marketing_leads SET status='converted', converted_customer_id=?,
       converted_at=?, updated_at=? WHERE id=?`
    ).run(customerId, now, now, row.id);
    addEvent(db, user, "lead", row.id, "converted", { customer_id: customerId });
  });
  tx();
  if (row.assignee_user_id !== user.id)
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.assignee_user_id,
      title: "营销线索已转客源",
      body: `${row.contact_name} 已转为私客`,
      kind: "marketing",
      ref_type: "customer",
      ref_id: customerId,
    });
  writeAudit(db, user, "marketing.lead.convert", "marketing_lead", row.id, {
    customer_id: customerId,
  });
  return { ok: true, data: { id: row.id, status: "converted", customer_id: customerId } };
}

export function listEntrustments(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (user.role === "finance") return { ok: true, data: [] };
  let rows = db
    .prepare(
      `SELECT e.*, s.name AS store_name, creator.display_name AS creator_name
       FROM marketing_online_entrustments e
       JOIN stores s ON s.id=e.store_id
       JOIN users creator ON creator.id=e.created_by
       WHERE e.company_id=? ORDER BY e.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => {
    if (user.role === "admin") return true;
    if (user.store_id !== row.store_id) return false;
    if (user.role === "store_manager") return true;
    return row.created_by === user.id;
  });
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      contact_phone:
        user.role === "admin" ||
        user.role === "store_manager" ||
        row.created_by === user.id
          ? row.contact_phone
          : maskPhone(row.contact_phone),
    })),
  };
}

export function createEntrustment(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role === "finance") return { ok: false, message: "财务无在线委托权限", code: 403 };
  if (!ENTRUST_TYPES.has(payload.entrust_type))
    return { ok: false, message: "在线委托类型无效" };
  const contactName = String(payload.contact_name || "").trim();
  const contactPhone = String(payload.contact_phone || "").replace(/\s/g, "");
  const content = String(payload.content || "").trim();
  if (!contactName || !/^1\d{10}$/.test(contactPhone) || !content)
    return { ok: false, message: "联系人、手机号和委托内容必填" };
  if (phoneBlocked(db, user.company_id, contactPhone))
    return { ok: false, message: "该电话已在业务或商机黑名单中" };
  const price =
    payload.expected_price == null || payload.expected_price === ""
      ? null
      : Number(payload.expected_price);
  if (price != null && (!Number.isFinite(price) || price < 0))
    return { ok: false, message: "期望价格无效" };
  const area =
    payload.area_size == null || payload.area_size === ""
      ? null
      : Number(payload.area_size);
  if (area != null && (!Number.isFinite(area) || area <= 0))
    return { ok: false, message: "面积无效" };
  const id = nextId("MKO");
  const now = nowIso();
  db.prepare(
    `INSERT INTO marketing_online_entrustments(
      id, company_id, store_id, entrust_type, contact_name, contact_phone,
      community, address, expected_price, rooms, area_size, content,
      status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    payload.entrust_type,
    contactName,
    contactPhone,
    String(payload.community || "").trim() || null,
    String(payload.address || "").trim() || null,
    price,
    String(payload.rooms || "").trim() || null,
    area,
    content,
    user.id,
    now,
    now
  );
  addEvent(db, user, "entrustment", id, "created");
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
      title: "新在线委托待处理",
      body: `${contactName} · ${payload.entrust_type}`,
      kind: "marketing",
      ref_type: "marketing_online_entrustment",
      ref_id: id,
    });
  }
  writeAudit(db, user, "marketing.entrustment.create", "marketing_online_entrustment", id);
  return { ok: true, data: { id, status: "new" } };
}

export function acceptEntrustment(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM marketing_online_entrustments WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (
    !row ||
    !(
      user.role === "admin" ||
      (user.role === "store_manager" && row.store_id === user.store_id)
    )
  )
    return { ok: false, message: "在线委托不存在或无受理权限", code: 403 };
  if (row.status !== "new") return { ok: false, message: "仅新委托可受理" };
  if (phoneBlocked(db, user.company_id, row.contact_phone))
    return { ok: false, message: "该电话已在业务或商机黑名单中" };
  const openLead = db
    .prepare(
      `SELECT id FROM marketing_leads WHERE company_id=? AND contact_phone=?
       AND status IN ('new', 'contacting', 'qualified')`
    )
    .get(user.company_id, row.contact_phone);
  if (openLead) return { ok: false, message: "该电话已有进行中线索，请先处理原线索" };
  const assigneeId = payload.assignee_user_id || user.id;
  const assignee = db
    .prepare(
      `SELECT id FROM users WHERE id=? AND company_id=? AND store_id=?
       AND status='active' AND role IN ('agent', 'store_manager')`
    )
    .get(assigneeId, user.company_id, row.store_id);
  if (!assignee) return { ok: false, message: "线索负责人必须为同店在职员工" };
  const leadId = nextId("MKL");
  const now = nowIso();
  const intent =
    row.entrust_type === "buy"
      ? "buy"
      : row.entrust_type === "rent"
        ? "rent"
        : row.entrust_type === "sell"
          ? "sell"
          : "entrust";
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO marketing_leads(
        id, company_id, store_id, campaign_id, contact_name, contact_phone,
        intent, channel, source_detail, need, budget_note, status,
        assignee_user_id, entrustment_id, remark, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'website', 'online_entrustment', ?, ?, 'new', ?, ?, ?, ?, ?, ?)`
    ).run(
      leadId,
      user.company_id,
      row.store_id,
      row.contact_name,
      row.contact_phone,
      intent,
      row.content,
      row.expected_price != null ? String(row.expected_price) : null,
      assigneeId,
      row.id,
      [row.community, row.address, row.rooms].filter(Boolean).join(" · ") || null,
      user.id,
      now,
      now
    );
    db.prepare(
      `UPDATE marketing_online_entrustments SET status='converted', lead_id=?,
       updated_at=? WHERE id=?`
    ).run(leadId, now, row.id);
    addEvent(db, user, "entrustment", row.id, "converted", { lead_id: leadId });
    addEvent(db, user, "lead", leadId, "created", { from_entrustment: row.id });
  });
  tx();
  if (assigneeId !== user.id)
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: assigneeId,
      title: "在线委托已转线索",
      body: row.contact_name,
      kind: "marketing",
      ref_type: "marketing_lead",
      ref_id: leadId,
    });
  writeAudit(db, user, "marketing.entrustment.accept", "marketing_online_entrustment", row.id, {
    lead_id: leadId,
  });
  return { ok: true, data: { id: row.id, status: "converted", lead_id: leadId } };
}

export function rejectEntrustment(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM marketing_online_entrustments WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (
    !row ||
    !(
      user.role === "admin" ||
      (user.role === "store_manager" && row.store_id === user.store_id)
    )
  )
    return { ok: false, message: "在线委托不存在或无驳回权限", code: 403 };
  if (row.status !== "new") return { ok: false, message: "仅新委托可驳回" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "驳回原因必填" };
  db.prepare(
    `UPDATE marketing_online_entrustments SET status='rejected', reject_reason=?,
     updated_at=? WHERE id=?`
  ).run(reason, nowIso(), row.id);
  addEvent(db, user, "entrustment", row.id, "rejected", { reason });
  writeAudit(db, user, "marketing.entrustment.reject", "marketing_online_entrustment", row.id);
  return { ok: true, data: { id: row.id, status: "rejected" } };
}

export function listMarketingEvents(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  if (!["campaign", "lead", "entrustment"].includes(payload.entity_type))
    return { ok: false, message: "履历对象类型无效" };
  let visible = false;
  if (payload.entity_type === "campaign") {
    const row = db
      .prepare(`SELECT * FROM marketing_campaigns WHERE id=? AND company_id=?`)
      .get(payload.entity_id, user.company_id) as any;
    visible = Boolean(row && campaignVisible(user, row));
  } else if (payload.entity_type === "lead") {
    const row = db
      .prepare(`SELECT * FROM marketing_leads WHERE id=? AND company_id=?`)
      .get(payload.entity_id, user.company_id) as any;
    visible = Boolean(row && leadVisible(user, row));
  } else {
    const row = db
      .prepare(
        `SELECT * FROM marketing_online_entrustments WHERE id=? AND company_id=?`
      )
      .get(payload.entity_id, user.company_id) as any;
    visible = Boolean(
      row &&
        (user.role === "admin" ||
          (user.role === "store_manager" && row.store_id === user.store_id) ||
          row.created_by === user.id)
    );
  }
  if (!visible) return { ok: false, message: "履历对象不存在或无权限", code: 403 };
  const events = db
    .prepare(
      `SELECT e.*, u.display_name AS created_by_name FROM marketing_events e
       JOIN users u ON u.id=e.created_by
       WHERE e.company_id=? AND e.entity_type=? AND e.entity_id=?
       ORDER BY e.created_at DESC`
    )
    .all(user.company_id, payload.entity_type, payload.entity_id);
  return { ok: true, data: events };
}
