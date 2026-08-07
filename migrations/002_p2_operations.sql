PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  district TEXT,
  address TEXT,
  building_count INTEGER,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS house_keys (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  key_no TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stored',
  keeper_user_id TEXT,
  borrower_user_id TEXT,
  borrowed_at TEXT,
  expected_return_at TEXT,
  returned_at TEXT,
  invalid_reason TEXT,
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, key_no),
  FOREIGN KEY (house_id) REFERENCES houses(id)
);

CREATE TABLE IF NOT EXISTS house_surveys (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  survey_type TEXT NOT NULL,
  survey_at TEXT NOT NULL,
  survey_user_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  image_urls TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'completed',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (house_id) REFERENCES houses(id)
);

CREATE TABLE IF NOT EXISTS house_verifications (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  contact_result TEXT,
  price_confirmed REAL,
  availability_confirmed INTEGER,
  submitted_by TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (house_id) REFERENCES houses(id)
);

CREATE TABLE IF NOT EXISTS earnest_moneys (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  deal_id TEXT,
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',
  refunded_at TEXT,
  refund_reason TEXT,
  applied_at TEXT,
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (house_id) REFERENCES houses(id),
  FOREIGN KEY (deal_id) REFERENCES deals(id)
);

CREATE INDEX IF NOT EXISTS idx_communities_company ON communities(company_id, status);
CREATE INDEX IF NOT EXISTS idx_house_keys_house ON house_keys(house_id, status);
CREATE INDEX IF NOT EXISTS idx_surveys_house ON house_surveys(house_id, survey_at);
CREATE INDEX IF NOT EXISTS idx_verifications_house ON house_verifications(house_id, status);
CREATE INDEX IF NOT EXISTS idx_earnest_customer ON earnest_moneys(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_earnest_house ON earnest_moneys(house_id, status);
