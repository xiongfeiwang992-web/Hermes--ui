CREATE TABLE IF NOT EXISTS expense_requests (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  applicant_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  expense_date TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  reject_reason TEXT,
  approved_by TEXT,
  approved_at TEXT,
  paid_by TEXT,
  paid_at TEXT,
  payment_method TEXT,
  payment_reference TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (applicant_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_expense_requests_scope
  ON expense_requests(company_id, store_id, applicant_user_id, status, created_at);
