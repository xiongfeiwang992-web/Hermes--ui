CREATE TABLE IF NOT EXISTS deal_mortgages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  deal_id TEXT NOT NULL UNIQUE,
  bank TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  applied_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  reject_reason TEXT,
  disbursed_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  remark TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id)
);

CREATE INDEX IF NOT EXISTS idx_deal_mortgages_status
  ON deal_mortgages(company_id, store_id, status);
