import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { createMessage } from "./message";
import { hashPassword } from "../utils/password";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

const JOB_ROLES = new Set(["store_manager", "agent", "finance"]);
const TRANSITIONS: Record<string, string[]> = {
  new: ["screening", "rejected", "withdrawn"],
  screening: ["interview", "rejected", "withdrawn"],
  interview: ["offer", "rejected", "withdrawn"],
  offer: ["rejected", "withdrawn"],
};

function canManage(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "store_manager";
}

function visible(user: SessionUser, row: any): boolean {
  return user.role === "admin" || row.store_id === user.store_id;
}

export function recruitmentOptions(db: Db, user: SessionUser): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  let stores = db
    .prepare(`SELECT id, name FROM stores WHERE company_id=? AND status='active' ORDER BY name`)
    .all(user.company_id) as any[];
  let jobs = db
    .prepare(
      `SELECT id, store_id, title, target_role FROM recruitment_jobs
       WHERE company_id=? AND status='open' ORDER BY created_at DESC`
    )
    .all(user.company_id) as any[];
  if (user.role === "store_manager") {
    stores = stores.filter((store) => store.id === user.store_id);
    jobs = jobs.filter((job) => job.store_id === user.store_id);
  }
  return { ok: true, data: { stores, jobs } };
}

export function listJobs(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT j.*, s.name AS store_name,
       (SELECT COUNT(*) FROM recruitment_candidates c WHERE c.job_id=j.id) AS candidate_count,
       (SELECT COUNT(*) FROM recruitment_candidates c
        WHERE c.job_id=j.id AND c.status='hired') AS hired_count
       FROM recruitment_jobs j JOIN stores s ON s.id=j.store_id
       WHERE j.company_id=? ORDER BY j.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function saveJob(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const title = String(payload.title || "").trim();
  const headcount = Number(payload.headcount);
  if (!title || !Number.isInteger(headcount) || headcount < 1 || headcount > 100)
    return { ok: false, message: "岗位名称和 1-100 招聘人数必填" };
  if (!JOB_ROLES.has(payload.target_role)) return { ok: false, message: "目标角色无效" };
  if (user.role === "store_manager" && payload.target_role !== "agent")
    return { ok: false, message: "店长仅可发布经纪人岗位", code: 403 };
  const storeId = user.role === "admin" ? payload.store_id : user.store_id;
  const store = db
    .prepare(`SELECT * FROM stores WHERE id=? AND company_id=? AND status='active'`)
    .get(storeId, user.company_id) as any;
  if (!store) return { ok: false, message: "招聘门店无效" };
  const now = nowIso();
  if (payload.id) {
    const existing = db
      .prepare(`SELECT * FROM recruitment_jobs WHERE id=? AND company_id=?`)
      .get(payload.id, user.company_id) as any;
    if (!existing || !visible(user, existing))
      return { ok: false, message: "招聘岗位不存在或无权限", code: 403 };
    if (existing.status === "closed") return { ok: false, message: "已关闭岗位不可编辑" };
    db.prepare(
      `UPDATE recruitment_jobs SET title=?, target_role=?, headcount=?,
       requirements=?, updated_at=? WHERE id=?`
    ).run(
      title,
      payload.target_role,
      headcount,
      String(payload.requirements || "").trim() || null,
      now,
      existing.id
    );
    writeAudit(db, user, "recruitment.job.update", "recruitment_job", existing.id);
    return { ok: true, data: { id: existing.id } };
  }
  const id = nextId("JOB");
  db.prepare(
    `INSERT INTO recruitment_jobs(
      id, company_id, store_id, title, target_role, headcount, requirements,
      status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    storeId,
    title,
    payload.target_role,
    headcount,
    String(payload.requirements || "").trim() || null,
    user.id,
    now,
    now
  );
  writeAudit(db, user, "recruitment.job.create", "recruitment_job", id);
  return { ok: true, data: { id, status: "open" } };
}

export function closeJob(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM recruitment_jobs WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !visible(user, row))
    return { ok: false, message: "招聘岗位不存在或无权限", code: 403 };
  if (row.status !== "open") return { ok: false, message: "岗位已关闭" };
  db.prepare(`UPDATE recruitment_jobs SET status='closed', updated_at=? WHERE id=?`).run(
    nowIso(),
    row.id
  );
  writeAudit(db, user, "recruitment.job.close", "recruitment_job", row.id);
  return { ok: true, data: { id: row.id, status: "closed" } };
}

export function listCandidates(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  let rows = db
    .prepare(
      `SELECT c.*, j.title AS job_title, j.target_role, s.name AS store_name,
       creator.display_name AS creator_name,
       (SELECT COUNT(*) FROM file_attachments a
        WHERE a.parent_type='recruitment_candidate' AND a.parent_id=c.id
        AND a.category='resume') AS resume_count
       FROM recruitment_candidates c
       JOIN recruitment_jobs j ON j.id=c.job_id
       JOIN stores s ON s.id=c.store_id
       JOIN users creator ON creator.id=c.created_by
       WHERE c.company_id=? ORDER BY c.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row));
  if (payload.job_id) rows = rows.filter((row) => row.job_id === payload.job_id);
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  return { ok: true, data: rows };
}

export function createCandidate(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const name = String(payload.name || "").trim();
  const phone = String(payload.phone || "").trim();
  if (!name || phone.length < 7) return { ok: false, message: "候选人姓名和有效电话必填" };
  const job = db
    .prepare(`SELECT * FROM recruitment_jobs WHERE id=? AND company_id=?`)
    .get(payload.job_id, user.company_id) as any;
  if (!job || !visible(user, job) || job.status !== "open")
    return { ok: false, message: "招聘岗位不存在、已关闭或无权限", code: 403 };
  const duplicate = db
    .prepare(
      `SELECT id FROM recruitment_candidates WHERE company_id=? AND phone=?
       AND status NOT IN ('hired','rejected','withdrawn')`
    )
    .get(user.company_id, phone);
  if (duplicate) return { ok: false, message: "该电话已有进行中的候选人记录", code: 409 };
  const id = nextId("CAN");
  const now = nowIso();
  db.prepare(
    `INSERT INTO recruitment_candidates(
      id, company_id, store_id, job_id, name, phone, source, status,
      note, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`
  ).run(
    id,
    user.company_id,
    job.store_id,
    job.id,
    name,
    phone,
    String(payload.source || "").trim() || null,
    String(payload.note || "").trim() || null,
    user.id,
    now,
    now
  );
  writeAudit(db, user, "recruitment.candidate.create", "recruitment_candidate", id, {
    job_id: job.id,
  });
  const recipients = new Set<string>();
  if (job.created_by) recipients.add(job.created_by);
  const admins = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND status='active' AND role='admin'`
    )
    .all(user.company_id) as { id: string }[];
  for (const admin of admins) recipients.add(admin.id);
  recipients.delete(user.id);
  for (const userId of recipients) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: job.store_id,
      user_id: userId,
      title: "新招聘候选人",
      body: `${name} · ${job.title}`,
      kind: "recruitment",
      ref_type: "recruitment_candidate",
      ref_id: id,
    });
  }
  return { ok: true, data: { id, status: "new" } };
}

export function changeCandidateStatus(
  db: Db,
  user: SessionUser,
  payload: any
): ApiResult {
  if (!canManage(user)) return { ok: false, message: "无权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM recruitment_candidates WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !visible(user, row))
    return { ok: false, message: "候选人不存在或无权限", code: 403 };
  if (!(TRANSITIONS[row.status] || []).includes(payload.status))
    return { ok: false, message: `不能从 ${row.status} 变更为 ${payload.status}` };
  const reason = String(payload.reason || "").trim();
  if (payload.status === "rejected" && !reason)
    return { ok: false, message: "淘汰原因必填" };
  let interviewAt: string | null = row.interview_at;
  if (payload.status === "interview") {
    const count = db
      .prepare(
        `SELECT COUNT(*) AS c FROM file_attachments WHERE company_id=?
         AND parent_type='recruitment_candidate' AND parent_id=? AND category='resume'`
      )
      .get(user.company_id, row.id) as { c: number };
    if (!count.c) return { ok: false, message: "进入面试前须上传简历" };
    const interviewMs = Date.parse(payload.interview_at);
    if (!Number.isFinite(interviewMs)) return { ok: false, message: "面试时间无效" };
    interviewAt = new Date(interviewMs).toISOString();
  }
  const now = nowIso();
  db.prepare(
    `UPDATE recruitment_candidates SET status=?, interview_at=?,
     reject_reason=?, note=COALESCE(?, note), updated_at=? WHERE id=?`
  ).run(
    payload.status,
    interviewAt,
    payload.status === "rejected" ? reason : null,
    payload.note || null,
    now,
    row.id
  );
  if (row.created_by !== user.id) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: row.store_id,
      user_id: row.created_by,
      title: "候选人状态更新",
      body: `${row.name}：${row.status} → ${payload.status}${reason ? ` · ${reason}` : ""}`,
      kind: "recruitment",
      ref_type: "recruitment_candidate",
      ref_id: row.id,
    });
  }
  writeAudit(db, user, "recruitment.candidate.status", "recruitment_candidate", row.id, {
    from: row.status,
    to: payload.status,
    reason,
  });
  return { ok: true, data: { id: row.id, status: payload.status } };
}

export function onboardCandidate(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "仅管理员可办理入职", code: 403 };
  const candidate = db
    .prepare(
      `SELECT c.*, j.target_role, j.headcount FROM recruitment_candidates c
       JOIN recruitment_jobs j ON j.id=c.job_id
       WHERE c.id=? AND c.company_id=?`
    )
    .get(payload.id, user.company_id) as any;
  if (!candidate || candidate.status !== "offer")
    return { ok: false, message: "仅已发 Offer 候选人可入职" };
  const account = String(payload.account || "").trim();
  const displayName = String(payload.display_name || candidate.name).trim();
  const password = String(payload.password || "");
  const policy = db
    .prepare(`SELECT password_min_length FROM settings WHERE company_id=?`)
    .get(user.company_id) as any;
  const minLength = Number(policy?.password_min_length || 8);
  if (!account || !displayName || password.length < minLength)
    return { ok: false, message: `账号、姓名必填，密码至少 ${minLength} 位` };
  const id = nextId("USR");
  const now = nowIso();
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO users(
        id, company_id, store_id, account, display_name, password_hash,
        role, phone, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).run(
      id,
      user.company_id,
      candidate.store_id,
      account,
      displayName,
      hashPassword(password),
      candidate.target_role,
      candidate.phone,
      now
    );
    db.prepare(
      `UPDATE recruitment_candidates SET status='hired', hired_user_id=?,
       updated_at=? WHERE id=?`
    ).run(id, now, candidate.id);
    const hired = db
      .prepare(
        `SELECT COUNT(*) AS c FROM recruitment_candidates
         WHERE job_id=? AND status='hired'`
      )
      .get(candidate.job_id) as { c: number };
    if (hired.c >= Number(candidate.headcount)) {
      db.prepare(`UPDATE recruitment_jobs SET status='closed', updated_at=? WHERE id=?`).run(
        now,
        candidate.job_id
      );
    }
  });
  try {
    transaction();
  } catch {
    return { ok: false, message: "员工账号已存在", code: 409 };
  }
  writeAudit(db, user, "recruitment.candidate.onboard", "recruitment_candidate", candidate.id, {
    user_id: id,
    role: candidate.target_role,
    store_id: candidate.store_id,
  });
  return { ok: true, data: { id: candidate.id, user_id: id, status: "hired" } };
}
