CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  budget REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS marketing_leads (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  campaign_id TEXT,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  intent TEXT NOT NULL,
  channel TEXT NOT NULL,
  source_detail TEXT,
  need TEXT,
  budget_note TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  assignee_user_id TEXT,
  converted_customer_id TEXT,
  entrustment_id TEXT,
  remark TEXT,
  lost_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  converted_at TEXT,
  FOREIGN KEY (campaign_id) REFERENCES marketing_campaigns(id),
  FOREIGN KEY (assignee_user_id) REFERENCES users(id),
  FOREIGN KEY (converted_customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS marketing_online_entrustments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  entrust_type TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  community TEXT,
  address TEXT,
  expected_price REAL,
  rooms TEXT,
  area_size REAL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  lead_id TEXT,
  reject_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (lead_id) REFERENCES marketing_leads(id)
);

CREATE TABLE IF NOT EXISTS marketing_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketing_leads_phone
  ON marketing_leads(company_id, contact_phone, status);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_store
  ON marketing_leads(company_id, store_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status
  ON marketing_campaigns(company_id, status, start_date);
CREATE INDEX IF NOT EXISTS idx_marketing_entrustments_store
  ON marketing_online_entrustments(company_id, store_id, status);
