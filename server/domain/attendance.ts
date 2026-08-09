import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import {
  isAllowedLeaveType,
  labelLeaveType,
  normalizeLeaveType,
} from "./config";
import { createMessage } from "./message";
import { nextId, nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function visible(user: SessionUser, row: any, ownerField: string): boolean {
  if (user.role === "admin") return true;
  if (user.role === "store_manager") return row.store_id === user.store_id;
  return row[ownerField] === user.id;
}

function settings(db: Db, companyId: string): any {
  const existing = db
    .prepare(`SELECT * FROM attendance_settings WHERE company_id=?`)
    .get(companyId) as any;
  if (existing) return existing;
  const now = nowIso();
  db.prepare(
    `INSERT INTO attendance_settings(company_id, work_start_time, work_end_time,
     late_grace_minutes, timezone_offset_minutes, updated_at)
     VALUES (?, '09:00', '18:00', 10, 480, ?)`
  ).run(companyId, now);
  return db
    .prepare(`SELECT * FROM attendance_settings WHERE company_id=?`)
    .get(companyId);
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function localParts(iso: string, offsetMinutes: number) {
  const shifted = new Date(Date.parse(iso) + offsetMinutes * 60000);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function attendanceStatus(db: Db, companyId: string, checkIn: string | null, checkOut: string | null) {
  const config = settings(db, companyId);
  const offset = Number(config.timezone_offset_minutes ?? 480);
  const inMinutes = checkIn ? localParts(checkIn, offset).minutes : null;
  const outMinutes = checkOut ? localParts(checkOut, offset).minutes : null;
  const late =
    inMinutes != null &&
    inMinutes > minutes(config.work_start_time) + Number(config.late_grace_minutes);
  const early = outMinutes != null && outMinutes < minutes(config.work_end_time);
  if (late && early) return "late_early";
  if (late) return "late";
  if (early) return "early_leave";
  return "normal";
}

export function getAttendanceSettings(db: Db, user: SessionUser): ApiResult {
  return { ok: true, data: settings(db, user.company_id) };
}

export function saveAttendanceSettings(db: Db, user: SessionUser, payload: any): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  if (
    !/^\d{2}:\d{2}$/.test(payload.work_start_time || "") ||
    !/^\d{2}:\d{2}$/.test(payload.work_end_time || "") ||
    minutes(payload.work_start_time) >= minutes(payload.work_end_time)
  )
    return { ok: false, message: "工作时间设置无效" };
  const grace = Number(payload.late_grace_minutes);
  if (!Number.isInteger(grace) || grace < 0 || grace > 120)
    return { ok: false, message: "迟到宽限须为 0-120 分钟整数" };
  db.prepare(
    `INSERT INTO attendance_settings(company_id, work_start_time, work_end_time,
     late_grace_minutes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET work_start_time=excluded.work_start_time,
     work_end_time=excluded.work_end_time, late_grace_minutes=excluded.late_grace_minutes,
     updated_by=excluded.updated_by, updated_at=excluded.updated_at`
  ).run(
    user.company_id,
    payload.work_start_time,
    payload.work_end_time,
    grace,
    user.id,
    nowIso()
  );
  writeAudit(db, user, "attendance.settings", "attendance_settings", user.company_id, {
    work_start_time: payload.work_start_time,
    work_end_time: payload.work_end_time,
    late_grace_minutes: grace,
  });
  return { ok: true, data: settings(db, user.company_id) };
}

export function clockAttendance(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!["in", "out"].includes(payload.kind))
    return { ok: false, message: "打卡类型无效" };
  const now = nowIso();
  const config = settings(db, user.company_id);
  const workDate = localParts(now, Number(config.timezone_offset_minutes ?? 480)).date;
  let row = db
    .prepare(
      `SELECT * FROM attendance_records WHERE company_id=? AND user_id=? AND work_date=?`
    )
    .get(user.company_id, user.id, workDate) as any;
  if (payload.kind === "in") {
    if (row?.check_in_at) return { ok: false, message: "今日已完成上班打卡" };
    if (!row) {
      const id = nextId("ATTN");
      db.prepare(
        `INSERT INTO attendance_records(
          id, company_id, store_id, user_id, work_date, check_in_at,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'normal', ?, ?)`
      ).run(id, user.company_id, user.store_id, user.id, workDate, now, now, now);
      row = db.prepare(`SELECT * FROM attendance_records WHERE id=?`).get(id) as any;
    } else {
      db.prepare(`UPDATE attendance_records SET check_in_at=?, updated_at=? WHERE id=?`).run(
        now,
        now,
        row.id
      );
      row.check_in_at = now;
    }
  } else {
    if (!row?.check_in_at) return { ok: false, message: "请先完成上班打卡" };
    if (row.check_out_at) return { ok: false, message: "今日已完成下班打卡" };
    db.prepare(`UPDATE attendance_records SET check_out_at=?, updated_at=? WHERE id=?`).run(
      now,
      now,
      row.id
    );
    row.check_out_at = now;
  }
  const status = attendanceStatus(
    db,
    user.company_id,
    row.check_in_at || null,
    row.check_out_at || null
  );
  db.prepare(`UPDATE attendance_records SET status=?, updated_at=? WHERE id=?`).run(
    status,
    now,
    row.id
  );
  writeAudit(db, user, `attendance.clock_${payload.kind}`, "attendance_record", row.id, {
    at: now,
    status,
  });
  return { ok: true, data: { id: row.id, kind: payload.kind, at: now, status } };
}

export function listAttendance(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT a.*, u.display_name AS user_name FROM attendance_records a
       JOIN users u ON u.id=a.user_id WHERE a.company_id=?
       ORDER BY a.work_date DESC, u.display_name`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row, "user_id"));
  if (payload.start_date) rows = rows.filter((row) => row.work_date >= payload.start_date);
  if (payload.end_date) rows = rows.filter((row) => row.work_date <= payload.end_date);
  if (payload.user_id) rows = rows.filter((row) => row.user_id === payload.user_id);
  return { ok: true, data: rows };
}

export function correctAttendance(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无修正权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM attendance_records WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !visible(user, row, "user_id"))
    return { ok: false, message: "考勤记录不存在或无权限", code: 403 };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "修正原因必填" };
  const checkInMs = Date.parse(payload.check_in_at);
  const checkOutMs = payload.check_out_at ? Date.parse(payload.check_out_at) : null;
  const checkIn = Number.isFinite(checkInMs) ? new Date(checkInMs).toISOString() : null;
  const checkOut =
    checkOutMs != null && Number.isFinite(checkOutMs)
      ? new Date(checkOutMs).toISOString()
      : null;
  if (
    !checkIn ||
    (payload.check_out_at && !checkOut) ||
    (checkOut && checkOut <= checkIn) ||
    localParts(checkIn, Number(settings(db, user.company_id).timezone_offset_minutes ?? 480))
      .date !== row.work_date ||
    (checkOut &&
      localParts(checkOut, Number(settings(db, user.company_id).timezone_offset_minutes ?? 480))
        .date !== row.work_date)
  )
    return { ok: false, message: "打卡修正时间无效或不属于考勤日期" };
  const status = attendanceStatus(db, user.company_id, checkIn, checkOut);
  db.prepare(
    `UPDATE attendance_records SET check_in_at=?, check_out_at=?, status=?,
     corrected_by=?, correction_reason=?, updated_at=? WHERE id=?`
  ).run(checkIn, checkOut, status, user.id, reason, nowIso(), row.id);
  writeAudit(db, user, "attendance.correct", "attendance_record", row.id, {
    reason,
    check_in_at: checkIn,
    check_out_at: checkOut,
    status,
  });
  return { ok: true, data: { id: row.id, status } };
}

export function createLeave(db: Db, user: SessionUser, payload: any): ApiResult {
  const leaveType = normalizeLeaveType(payload.leave_type);
  if (!leaveType || !isAllowedLeaveType(db, user.company_id, leaveType))
    return { ok: false, message: "请假类型无效" };
  const reason = String(payload.reason || "").trim();
  if (!reason) return { ok: false, message: "请假原因必填" };
  const startMs = Date.parse(payload.start_at);
  const endMs = Date.parse(payload.end_at);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
    return { ok: false, message: "请假起止时间无效" };
  const durationHours = Math.round(((endMs - startMs) / 3600000) * 100) / 100;
  const overlap = db
    .prepare(
      `SELECT id FROM leave_requests WHERE company_id=? AND applicant_user_id=?
       AND status IN ('pending','approved') AND start_at<? AND end_at>?`
    )
    .get(user.company_id, user.id, new Date(endMs).toISOString(), new Date(startMs).toISOString());
  if (overlap) return { ok: false, message: "该时段已有待审批或已通过请假", code: 409 };
  const id = nextId("LEV");
  const now = nowIso();
  db.prepare(
    `INSERT INTO leave_requests(
      id, company_id, store_id, applicant_user_id, leave_type,
      start_at, end_at, duration_hours, reason, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(
    id,
    user.company_id,
    user.store_id,
    user.id,
    leaveType,
    new Date(startMs).toISOString(),
    new Date(endMs).toISOString(),
    durationHours,
    reason,
    now,
    now
  );
  const managers = db
    .prepare(
      `SELECT id FROM users WHERE company_id=? AND store_id=? AND role='store_manager'
       AND status='active' AND id<>?`
    )
    .all(user.company_id, user.store_id, user.id) as any[];
  for (const manager of managers) {
    createMessage(db, {
      company_id: user.company_id,
      store_id: user.store_id,
      user_id: manager.id,
      title: "请假申请待审批",
      body: `${user.display_name} · ${durationHours} 小时`,
      kind: "leave_pending",
      ref_type: "leave_request",
      ref_id: id,
    });
  }
  writeAudit(db, user, "leave.create", "leave_request", id, {
    leave_type: leaveType,
    duration_hours: durationHours,
  });
  return { ok: true, data: { id, status: "pending", duration_hours: durationHours } };
}

export function listLeaves(db: Db, user: SessionUser, payload: any = {}): ApiResult {
  let rows = db
    .prepare(
      `SELECT l.*, applicant.display_name AS applicant_name,
       reviewer.display_name AS reviewer_name
       FROM leave_requests l JOIN users applicant ON applicant.id=l.applicant_user_id
       LEFT JOIN users reviewer ON reviewer.id=l.reviewed_by
       WHERE l.company_id=? ORDER BY l.created_at DESC`
    )
    .all(user.company_id) as any[];
  rows = rows.filter((row) => visible(user, row, "applicant_user_id"));
  if (payload.status) rows = rows.filter((row) => row.status === payload.status);
  if (payload.user_id) rows = rows.filter((row) => row.applicant_user_id === payload.user_id);
  if (payload.leave_type) {
    const leaveType = normalizeLeaveType(payload.leave_type);
    rows = rows.filter((row) => normalizeLeaveType(row.leave_type) === leaveType);
  }
  return {
    ok: true,
    data: rows.map((row) => ({
      ...row,
      leave_type_label: labelLeaveType(db, user.company_id, row.leave_type),
    })),
  };
}

export function reviewLeave(db: Db, user: SessionUser, payload: any): ApiResult {
  if (!(user.role === "admin" || user.role === "store_manager"))
    return { ok: false, message: "无审批权限", code: 403 };
  const row = db
    .prepare(`SELECT * FROM leave_requests WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || !visible(user, row, "applicant_user_id"))
    return { ok: false, message: "请假申请不存在或无权限", code: 403 };
  if (row.applicant_user_id === user.id)
    return { ok: false, message: "申请人不可审批自己的请假" };
  if (row.status !== "pending") return { ok: false, message: "仅待审批申请可处理" };
  if (!["approved", "rejected"].includes(payload.status))
    return { ok: false, message: "审批状态无效" };
  const reason = String(payload.reason || "").trim();
  if (payload.status === "rejected" && !reason)
    return { ok: false, message: "驳回原因必填" };
  const now = nowIso();
  db.prepare(
    `UPDATE leave_requests SET status=?, reviewed_by=?, reviewed_at=?,
     reject_reason=?, updated_at=? WHERE id=?`
  ).run(payload.status, user.id, now, payload.status === "rejected" ? reason : null, now, row.id);
  createMessage(db, {
    company_id: user.company_id,
    store_id: row.store_id,
    user_id: row.applicant_user_id,
    title: payload.status === "approved" ? "请假申请已通过" : "请假申请已驳回",
    body: reason || `${row.duration_hours} 小时请假`,
    kind: "leave_review",
    ref_type: "leave_request",
    ref_id: row.id,
  });
  writeAudit(db, user, `leave.${payload.status}`, "leave_request", row.id, { reason });
  return { ok: true, data: { id: row.id, status: payload.status } };
}

export function cancelLeave(db: Db, user: SessionUser, payload: any): ApiResult {
  const row = db
    .prepare(`SELECT * FROM leave_requests WHERE id=? AND company_id=?`)
    .get(payload.id, user.company_id) as any;
  if (!row || row.applicant_user_id !== user.id)
    return { ok: false, message: "请假申请不存在或无权限", code: 403 };
  if (row.status !== "pending") return { ok: false, message: "仅待审批请假可取消" };
  const now = nowIso();
  db.prepare(
    `UPDATE leave_requests SET status='cancelled', cancelled_at=?, updated_at=? WHERE id=?`
  ).run(now, now, row.id);
  writeAudit(db, user, "leave.cancel", "leave_request", row.id);
  return { ok: true, data: { id: row.id, status: "cancelled" } };
}
