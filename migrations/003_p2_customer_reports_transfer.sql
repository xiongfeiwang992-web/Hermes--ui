PRAGMA foreign_keys = ON;

ALTER TABLE settings ADD COLUMN public_pool_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN updated_by TEXT;

ALTER TABLE customers ADD COLUMN merged_into_id TEXT;
ALTER TABLE customers ADD COLUMN merged_at TEXT;

CREATE TABLE IF NOT EXISTS customer_contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relation TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS customer_merge_logs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  source_customer_id TEXT NOT NULL,
  target_customer_id TEXT NOT NULL,
  merged_by TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_nodes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  planned_at TEXT,
  completed_at TEXT,
  assignee_user_id TEXT,
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer
  ON customer_contacts(customer_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_customers_merged
  ON customers(company_id, merged_into_id);
CREATE INDEX IF NOT EXISTS idx_transfer_nodes_deal
  ON transfer_nodes(deal_id, status);
