PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS business_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  module TEXT NOT NULL,
  record_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  owner_user_id TEXT,
  assignee_user_id TEXT,
  amount REAL,
  start_at TEXT,
  due_at TEXT,
  completed_at TEXT,
  parent_type TEXT,
  parent_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blacklists (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value_hash TEXT NOT NULL,
  display_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, kind, value_hash)
);

CREATE TABLE IF NOT EXISTS feature_permissions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  role TEXT NOT NULL,
  feature TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, role, feature)
);

CREATE TABLE IF NOT EXISTS integration_configs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'adapter_only',
  endpoint TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  health_status TEXT NOT NULL DEFAULT 'not_configured',
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, provider)
);

CREATE TABLE IF NOT EXISTS file_attachments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  parent_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_business_records_module
  ON business_records(company_id, module, record_type, status);
CREATE INDEX IF NOT EXISTS idx_business_records_store
  ON business_records(store_id, due_at);
CREATE INDEX IF NOT EXISTS idx_blacklists_lookup
  ON blacklists(company_id, kind, value_hash, status);
CREATE INDEX IF NOT EXISTS idx_attachments_parent
  ON file_attachments(parent_type, parent_id, category);
