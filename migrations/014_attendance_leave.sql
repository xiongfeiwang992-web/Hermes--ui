CREATE TABLE IF NOT EXISTS attendance_settings (
  company_id TEXT PRIMARY KEY,
  work_start_time TEXT NOT NULL DEFAULT '09:00',
  work_end_time TEXT NOT NULL DEFAULT '18:00',
  late_grace_minutes INTEGER NOT NULL DEFAULT 10,
  timezone_offset_minutes INTEGER NOT NULL DEFAULT 480,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  check_in_at TEXT,
  check_out_at TEXT,
  status TEXT NOT NULL DEFAULT 'normal',
  corrected_by TEXT,
  correction_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, user_id, work_date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  applicant_user_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  duration_hours REAL NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (applicant_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_scope
  ON attendance_records(company_id, store_id, user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_scope
  ON leave_requests(company_id, store_id, applicant_user_id, status, start_at);
