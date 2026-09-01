import type { Db } from "../db/database";
import { canWriteListing, houseVisibleTo } from "../auth/policy";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";
import { ensureHouseRole, roleAllowsOperation } from "./house";

function canOperateStore(user: SessionUser, storeId: string): boolean {
  return user.role === "admin" || user.store_id === storeId;
}

function defaultProtectionUntil(db: Db, companyId: string): string | null {
  const setting = db
    .prepare(`SELECT house_role_protection_days FROM settings WHERE company_id=?`)
    .get(companyId) as any;
  const days = Number(setting?.house_role_protection_days || 0);
  return days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
}

export function listCommunities(
  db: Db,
  user: SessionUser,
  query: { keyword?: string } = {}
): ApiResult {
  let rows = db
    .prepare(
      `SELECT c.*, COUNT(h.id) AS house_count
       FROM communities c
       LEFT JOIN houses h ON h.company_id = c.company_id AND h.community = c.name
       WHERE c.company_id = ? AND c.status = 'active'
       GROUP BY c.id
       ORDER BY c.name`
    )
    .all(user.company_id) as any[];
  if (query.keyword) {
    const keyword = query.keyword.trim();
    rows = rows.filter(
      (row) =>
        row.name.includes(keyword) ||
        (row.district || "").includes(keyword) ||
        (row.address || "").includes(keyword)
    );
  }
  return { ok: true, data: rows };
}

export function upsertCommunity(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) {
    return { ok: false, message: "无权限", code: 403 };
  }
  const name = String(payload.name || "").trim();
  if (!name) return { ok: false, message: "小区名称必填" };
  const now = nowIso();
  if (payload.id) {
    const existing = db
      .prepare(`SELECT * FROM communities WHERE id = ? AND company_id = ?`)
      .get(payload.id, user.company_id) as any;
    if (!existing) return { ok: false, message: "小区不存在" };
    try {
      db.prepare(
        `UPDATE communities SET name = ?, district = ?, address = ?,
         building_count = ?, remark = ?, updated_at = ?
         WHERE id = ? AND company_id = ?`
      ).run(
        name,
        payload.district || null,
        payload.address || null,
        payload.building_count == null ? null : Number(payload.building_count),
        payload.remark || null,
        now,
        payload.id,
        user.company_id
      );
    } catch {
      return { ok: false, message: "同名小区已存在", code: 409 };
    }
    writeAudit(db, user, "community.update", "community", payload.id);
    return { ok: true, data: { id: payload.id } };
  }
  const id = nextId("COM");
  try {
    db.prepare(
      `INSERT INTO communities(
        id, company_id, name, district, address, building_count, remark,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      name,
      payload.district || null,
      payload.address || null,
      payload.building_count == null ? null : Number(payload.building_count),
      payload.remark || null,
      user.id,
      now,
      now
    );
  } catch {
    return { ok: false, message: "同名小区已存在", code: 409 };
  }
  writeAudit(db, user, "community.create", "community", id, { name });
  return { ok: true, data: { id } };
}

export function listKeys(db: Db, user: SessionUser, query: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT k.*, h.title AS house_title, u.display_name AS borrower_name
       FROM house_keys k
       JOIN houses h ON h.id = k.house_id
       LEFT JOIN users u ON u.id = k.borrower_user_id
       WHERE k.company_id = ?
       ORDER BY k.updated_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter(
    (row) =>
      canOperateStore(user, row.store_id) &&
      houseVisibleTo(user, {
        store_id: row.store_id,
        agent_id: row.keeper_user_id || row.created_by,
        is_private: 0,
      })
  );
  if (query.house_id) rows = rows.filter((row) => row.house_id === query.house_id);
  if (query.status) rows = rows.filter((row) => row.status === query.status);
  return { ok: true, data: rows };
}

export function registerKey(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const house = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.house_id, user.company_id) as any;
  if (!house || !houseVisibleTo(user, house)) {
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  }
  const keyNo = String(payload.key_no || "").trim();
  if (!keyNo) return { ok: false, message: "钥匙编号必填" };
  const id = nextId("KEY");
  const now = nowIso();
  try {
    db.prepare(
      `INSERT INTO house_keys(
        id, company_id, store_id, house_id, key_no, status, keeper_user_id,
        remark, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'stored', ?, ?, ?, ?, ?)`
    ).run(
      id,
      user.company_id,
      house.store_id,
      house.id,
      keyNo,
      payload.keeper_user_id || user.id,
      payload.remark || null,
      user.id,
      now,
      now
    );
  } catch {
    return { ok: false, message: "钥匙编号已存在", code: 409 };
  }
  writeAudit(db, user, "key.register", "house_key", id, { house_id: house.id });
  return { ok: true, data: { id } };
}

export function borrowKey(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const key = db
    .prepare(`SELECT * FROM house_keys WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!key || !canOperateStore(user, key.store_id)) {
    return { ok: false, message: "钥匙不存在或无权限", code: 403 };
  }
  if (key.status !== "stored") return { ok: false, message: "钥匙当前不可借出" };
  const borrowerId = payload.borrower_user_id || user.id;
  const borrower = db
    .prepare(`SELECT * FROM users WHERE id = ? AND company_id = ? AND status = 'active'`)
    .get(borrowerId, user.company_id) as any;
  if (!borrower || (user.role !== "admin" && borrower.store_id !== key.store_id)) {
    return { ok: false, message: "借用人无效" };
  }
  const now = nowIso();
  db.prepare(
    `UPDATE house_keys SET status = 'borrowed', borrower_user_id = ?,
     borrowed_at = ?, expected_return_at = ?, returned_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(borrowerId, now, payload.expected_return_at || null, now, key.id);
  writeAudit(db, user, "key.borrow", "house_key", key.id, { borrower_id: borrowerId });
  createMessage(db, {
    company_id: user.company_id,
    store_id: key.store_id,
    user_id: borrowerId,
    title: "钥匙已借出",
    body: `钥匙 ${key.key_no} 已登记借用`,
    kind: "key_borrow",
    ref_type: "house_key",
    ref_id: key.id,
  });
  return { ok: true, data: { id: key.id } };
}

export function returnKey(db: Db, user: SessionUser, payload: { id: string }): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const key = db
    .prepare(`SELECT * FROM house_keys WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!key || !canOperateStore(user, key.store_id)) {
    return { ok: false, message: "钥匙不存在或无权限", code: 403 };
  }
  if (key.status !== "borrowed") return { ok: false, message: "钥匙未处于借出状态" };
  const now = nowIso();
  db.prepare(
    `UPDATE house_keys SET status = 'stored', returned_at = ?, borrower_user_id = NULL,
     borrowed_at = NULL, expected_return_at = NULL, updated_at = ? WHERE id = ?`
  ).run(now, now, key.id);
  writeAudit(db, user, "key.return", "house_key", key.id);
  return { ok: true, data: { id: key.id } };
}

export function invalidateKey(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "作废原因必填" };
  const key = db
    .prepare(`SELECT * FROM house_keys WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!key || !canOperateStore(user, key.store_id)) {
    return { ok: false, message: "钥匙不存在或无权限", code: 403 };
  }
  if (key.status === "borrowed") return { ok: false, message: "借出中的钥匙不可作废" };
  db.prepare(
    `UPDATE house_keys SET status = 'invalid', invalid_reason = ?, updated_at = ? WHERE id = ?`
  ).run(reason, nowIso(), key.id);
  writeAudit(db, user, "key.invalidate", "house_key", key.id, { reason });
  return { ok: true, data: { id: key.id } };
}

export function createSurvey(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const house = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.house_id, user.company_id) as any;
  if (!house || !houseVisibleTo(user, house)) {
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  }
  if (!["survey", "vacant_view"].includes(payload.survey_type)) {
    return { ok: false, message: "实勘类型无效" };
  }
  const summary = String(payload.summary || "").trim();
  if (!summary) return { ok: false, message: "实勘摘要必填" };
  if (!roleAllowsOperation(db, house.id, "surveyor", user))
    return { ok: false, message: "实勘角色处于他人保护期，无权操作", code: 403 };
  const surveyUserId = payload.survey_user_id || user.id;
  const surveyUser = db
    .prepare(`SELECT * FROM users WHERE id=? AND company_id=? AND status='active'`)
    .get(surveyUserId, user.company_id) as any;
  if (!surveyUser || surveyUser.store_id !== house.store_id)
    return { ok: false, message: "实勘人须为房源同店在职员工" };
  const id = nextId("SVY");
  db.prepare(
    `INSERT INTO house_surveys(
      id, company_id, store_id, house_id, survey_type, survey_at,
      survey_user_id, summary, image_urls, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`
  ).run(
    id,
    user.company_id,
    house.store_id,
    house.id,
    payload.survey_type,
    payload.survey_at || nowIso(),
    surveyUserId,
    summary,
    JSON.stringify(payload.image_urls || []),
    user.id,
    nowIso()
  );
  ensureHouseRole(
    db,
    house,
    "surveyor",
    surveyUserId,
    user.id,
    defaultProtectionUntil(db, user.company_id)
  );
  writeAudit(db, user, "survey.create", "house_survey", id, { house_id: house.id });
  if (house.agent_id && house.agent_id !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: house.store_id,
      user_id: house.agent_id,
      title: payload.survey_type === "vacant_view" ? "空看已完成" : "实勘已完成",
      body: `${house.title} · ${summary}`,
      kind: "business_record_status",
      ref_type: "house_survey",
      ref_id: id,
    });
  }
  return { ok: true, data: { id } };
}

export function listSurveys(db: Db, user: SessionUser, query: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT s.*, h.title AS house_title, u.display_name AS survey_user_name
       FROM house_surveys s
       JOIN houses h ON h.id = s.house_id
       JOIN users u ON u.id = s.survey_user_id
       WHERE s.company_id = ? ORDER BY s.survey_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => canOperateStore(user, row.store_id));
  if (query.house_id) rows = rows.filter((row) => row.house_id === query.house_id);
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      image_urls: JSON.parse(row.image_urls || "[]"),
    })),
  };
}

export function submitVerification(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canWriteListing(user)) return { ok: false, message: "无权限", code: 403 };
  const house = db
    .prepare(`SELECT * FROM houses WHERE id = ? AND company_id = ?`)
    .get(payload.house_id, user.company_id) as any;
  if (!house || !houseVisibleTo(user, house)) {
    return { ok: false, message: "房源不存在或无权限", code: 403 };
  }
  if (!roleAllowsOperation(db, house.id, "verifier", user))
    return { ok: false, message: "核验角色处于他人保护期，无权操作", code: 403 };
  const id = nextId("VER");
  const now = nowIso();
  db.prepare(
    `INSERT INTO house_verifications(
      id, company_id, store_id, house_id, status, contact_result,
      price_confirmed, availability_confirmed, submitted_by, submitted_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    house.store_id,
    house.id,
    payload.contact_result || null,
    payload.price_confirmed == null ? null : Number(payload.price_confirmed),
    payload.availability_confirmed == null
      ? null
      : payload.availability_confirmed
        ? 1
        : 0,
    user.id,
    now,
    now
  );
  ensureHouseRole(
    db,
    house,
    "verifier",
    user.id,
    user.id,
    defaultProtectionUntil(db, user.company_id)
  );
  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id = ? AND store_id = ?
       AND role IN ('store_manager','admin') AND status = 'active'`
    )
    .all(user.company_id, house.store_id) as any[];
  for (const manager of managers) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: house.store_id,
      user_id: manager.id,
      title: "房源验真待审核",
      body: `${house.title} 的验真记录待审核`,
      kind: "verification_pending",
      ref_type: "house_verification",
      ref_id: id,
    });
  }
  writeAudit(db, user, "verification.submit", "house_verification", id);
  return { ok: true, data: { id } };
}

export function listVerifications(db: Db, user: SessionUser, query: any = {}): ApiResult {
  if (user.role === "finance") return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT v.*, h.title AS house_title, u.display_name AS submitted_by_name
       FROM house_verifications v
       JOIN houses h ON h.id = v.house_id
       JOIN users u ON u.id = v.submitted_by
       WHERE v.company_id = ? ORDER BY v.submitted_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => canOperateStore(user, row.store_id));
  if (query.status) rows = rows.filter((row) => row.status === query.status);
  if (query.house_id) rows = rows.filter((row) => row.house_id === query.house_id);
  return { ok: true, data: rows };
}

export function reviewVerification(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager")) {
    return { ok: false, message: "无权限", code: 403 };
  }
  if (!["approved", "rejected"].includes(payload.status)) {
    return { ok: false, message: "审核结果无效" };
  }
  if (payload.status === "rejected" && !String(payload.reason || "").trim()) {
    return { ok: false, message: "驳回原因必填" };
  }
  const record = db
    .prepare(`SELECT * FROM house_verifications WHERE id = ? AND company_id = ?`)
    .get(payload.id, user.company_id) as any;
  if (!record || !canOperateStore(user, record.store_id)) {
    return { ok: false, message: "验真记录不存在或无权限", code: 403 };
  }
  if (record.status !== "pending") return { ok: false, message: "验真记录已审核" };
  const now = nowIso();
  db.prepare(
    `UPDATE house_verifications SET status = ?, reviewed_by = ?, reviewed_at = ?,
     reject_reason = ?, updated_at = ? WHERE id = ?`
  ).run(payload.status, user.id, now, payload.reason || null, now, record.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: record.store_id,
    user_id: record.submitted_by,
    title: payload.status === "approved" ? "房源验真已通过" : "房源验真已驳回",
    body:
      payload.status === "approved"
        ? `验真记录 ${record.id} 已通过`
        : `验真记录 ${record.id} 已驳回：${payload.reason}`,
    kind: "verification_review",
    ref_type: "house_verification",
    ref_id: record.id,
  });
  writeAudit(db, user, "verification.review", "house_verification", record.id, {
    status: payload.status,
    reason: payload.reason,
  });
  return { ok: true, data: { id: record.id, status: payload.status } };
}
