CREATE TABLE IF NOT EXISTS deal_complaints (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  assignee_user_id TEXT,
  resolution TEXT,
  reject_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (deal_id) REFERENCES deals(id),
  FOREIGN KEY (assignee_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS deal_renames (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  target TEXT NOT NULL,
  old_customer_name TEXT,
  new_customer_name TEXT,
  old_owner_name TEXT,
  new_owner_name TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  reject_reason TEXT,
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  approved_at TEXT,
  FOREIGN KEY (deal_id) REFERENCES deals(id)
);

CREATE TABLE IF NOT EXISTS deal_ext_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deal_complaints_deal
  ON deal_complaints(company_id, deal_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_deal_renames_deal
  ON deal_renames(company_id, deal_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_deal_ext_events_entity
  ON deal_ext_events(company_id, entity_type, entity_id, created_at);
