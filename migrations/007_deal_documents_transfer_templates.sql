ALTER TABLE settings ADD COLUMN deal_doc_required INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS deal_doc_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  deal_type TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, deal_type, category)
);

CREATE TABLE IF NOT EXISTS deal_doc_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  attachment_id TEXT,
  received_by TEXT,
  received_at TEXT,
  checked_by TEXT,
  checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (deal_id) REFERENCES deals(id),
  FOREIGN KEY (attachment_id) REFERENCES file_attachments(id),
  UNIQUE(deal_id, category)
);

CREATE TABLE IF NOT EXISTS transfer_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  deal_type TEXT NOT NULL,
  node_type TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  default_assignee_role TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, deal_type, node_type)
);

CREATE INDEX IF NOT EXISTS idx_deal_doc_items_deal
  ON deal_doc_items(deal_id, status, required);
CREATE INDEX IF NOT EXISTS idx_transfer_templates_type
  ON transfer_templates(company_id, deal_type, status, sort_order);
