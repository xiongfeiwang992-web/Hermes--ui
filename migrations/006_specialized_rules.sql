ALTER TABLE settings ADD COLUMN house_hold_limit INTEGER NOT NULL DEFAULT 20;
ALTER TABLE settings ADD COLUMN manager_award_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE settings ADD COLUMN deal_required_fields TEXT NOT NULL DEFAULT '[]';
ALTER TABLE settings ADD COLUMN password_min_length INTEGER NOT NULL DEFAULT 8;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  list_density TEXT NOT NULL DEFAULT 'comfortable',
  watermark_enabled INTEGER NOT NULL DEFAULT 0,
  theme TEXT NOT NULL DEFAULT 'light',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_dictionaries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  dict_type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, dict_type, value)
);

CREATE TABLE IF NOT EXISTS commission_tiers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  min_amount REAL NOT NULL,
  max_amount REAL,
  pool_rate REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contract_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  deal_type TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deal_signoffs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  signer_user_id TEXT NOT NULL,
  signer_name TEXT NOT NULL,
  statement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'signed',
  signed_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
