CREATE TABLE IF NOT EXISTS finance_assets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  original_value REAL NOT NULL,
  residual_value REAL NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT,
  custodian_user_id TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'in_use',
  disposed_at TEXT,
  dispose_reason TEXT,
  dispose_amount REAL,
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, code),
  FOREIGN KEY (custodian_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS finance_vouchers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  voucher_no TEXT NOT NULL,
  voucher_date TEXT NOT NULL,
  summary TEXT NOT NULL,
  debit_total REAL NOT NULL DEFAULT 0,
  credit_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  source_type TEXT,
  source_id TEXT,
  void_reason TEXT,
  posted_by TEXT,
  posted_at TEXT,
  voided_by TEXT,
  voided_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, voucher_no)
);

CREATE TABLE IF NOT EXISTS finance_voucher_lines (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  voucher_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  account_name TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount REAL NOT NULL,
  memo TEXT,
  FOREIGN KEY (voucher_id) REFERENCES finance_vouchers(id)
);

CREATE TABLE IF NOT EXISTS finance_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_finance_assets_store
  ON finance_assets(company_id, store_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_finance_vouchers_store
  ON finance_vouchers(company_id, store_id, status, voucher_date);
CREATE INDEX IF NOT EXISTS idx_finance_voucher_lines
  ON finance_voucher_lines(voucher_id, line_no);
CREATE INDEX IF NOT EXISTS idx_finance_events_entity
  ON finance_events(company_id, entity_type, entity_id, created_at);
