PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  account TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  UNIQUE(company_id, account),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
  company_id TEXT PRIMARY KEY,
  agent_pool_rate REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS houses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  title TEXT NOT NULL,
  deal_type TEXT NOT NULL,
  status TEXT NOT NULL,
  community TEXT NOT NULL,
  address TEXT,
  district TEXT,
  price REAL NOT NULL,
  price_unit TEXT NOT NULL,
  area_size REAL,
  rooms TEXT,
  floor TEXT,
  owner_name TEXT NOT NULL,
  owner_phone TEXT NOT NULL,
  listing_user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  is_private INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  remark TEXT,
  cover_image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  intent TEXT NOT NULL,
  budget_min REAL,
  budget_max REAL,
  budget_note TEXT,
  need TEXT,
  level TEXT NOT NULL DEFAULT 'B',
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'new',
  agent_id TEXT NOT NULL,
  source TEXT,
  remark TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  content TEXT NOT NULL,
  method TEXT,
  next_follow_at TEXT,
  created_by TEXT NOT NULL,
  voided INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  view_at TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  accompany_ids TEXT,
  feedback TEXT NOT NULL DEFAULT 'pending',
  content TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  cancel_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  deal_type TEXT NOT NULL,
  house_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  view_id TEXT,
  contract_price REAL NOT NULL,
  commission_total REAL NOT NULL,
  commission_owner REAL NOT NULL DEFAULT 0,
  commission_customer REAL NOT NULL DEFAULT 0,
  deal_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  agent_ids TEXT NOT NULL,
  split_ratios TEXT NOT NULL,
  remark TEXT,
  contract_attachment TEXT,
  submitted_by TEXT,
  submitted_at TEXT,
  approved_by TEXT,
  approved_at TEXT,
  reject_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  amount REAL NOT NULL,
  pay_type TEXT NOT NULL,
  method TEXT NOT NULL,
  paid_at TEXT NOT NULL,
  payer_side TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commissions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ratio REAL NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'accrued',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_houses_store ON houses(store_id, status);
CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id, visibility, status);
CREATE INDEX IF NOT EXISTS idx_follows_target ON follows(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_views_store ON views(store_id, view_at);
CREATE INDEX IF NOT EXISTS idx_deals_store ON deals(store_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_deal ON payments(deal_id);
CREATE INDEX IF NOT EXISTS idx_commissions_user ON commissions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, is_read);
