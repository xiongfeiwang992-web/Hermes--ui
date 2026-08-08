CREATE TABLE IF NOT EXISTS cashbook_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  occurred_at TEXT NOT NULL,
  counterparty TEXT,
  payment_method TEXT NOT NULL,
  deal_id TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  void_reason TEXT,
  voided_by TEXT,
  voided_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id)
);

CREATE INDEX IF NOT EXISTS idx_cashbook_scope
  ON cashbook_entries(company_id, store_id, occurred_at, direction, status);
