CREATE TABLE IF NOT EXISTS salary_profiles (
  user_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  base_salary REAL NOT NULL DEFAULT 0,
  fixed_allowance REAL NOT NULL DEFAULT 0,
  fixed_deduction REAL NOT NULL DEFAULT 0,
  bank_name TEXT,
  bank_account TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payroll_batches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  employee_count INTEGER NOT NULL DEFAULT 0,
  gross_total REAL NOT NULL DEFAULT 0,
  net_total REAL NOT NULL DEFAULT 0,
  approved_by TEXT,
  approved_at TEXT,
  paid_by TEXT,
  paid_at TEXT,
  payment_reference TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, payroll_month)
);

CREATE TABLE IF NOT EXISTS payroll_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  base_salary REAL NOT NULL,
  allowance REAL NOT NULL DEFAULT 0,
  bonus REAL NOT NULL DEFAULT 0,
  deduction REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  gross_amount REAL NOT NULL,
  net_amount REAL NOT NULL,
  adjustment_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(batch_id, user_id),
  FOREIGN KEY (batch_id) REFERENCES payroll_batches(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payroll_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_scope
  ON payroll_items(company_id, batch_id, store_id, user_id);
