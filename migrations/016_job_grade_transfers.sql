CREATE TABLE IF NOT EXISTS job_grades (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  rank_level INTEGER NOT NULL,
  applicable_role TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, code),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS employee_job_assignments (
  user_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  job_grade_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (job_grade_id) REFERENCES job_grades(id)
);

CREATE TABLE IF NOT EXISTS employee_grade_history (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  from_grade_id TEXT,
  to_grade_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_transfer_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  from_store_id TEXT NOT NULL,
  to_store_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  handover_user_id TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  house_count INTEGER NOT NULL DEFAULT 0,
  customer_count INTEGER NOT NULL DEFAULT 0,
  key_count INTEGER NOT NULL DEFAULT 0,
  role_count INTEGER NOT NULL DEFAULT 0,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  cancelled_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (handover_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_transfer_scope
  ON employee_transfer_requests(company_id, from_store_id, to_store_id, user_id, status);
