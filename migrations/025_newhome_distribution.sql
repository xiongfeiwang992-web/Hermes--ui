CREATE TABLE IF NOT EXISTS newhome_distribution_companies (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_phone TEXT,
  address TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS newhome_sales_reports (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  registration_id TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  distribution_company_id TEXT,
  building TEXT,
  unit_no TEXT NOT NULL,
  area_size REAL,
  contract_price REAL NOT NULL,
  signed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  settlement_amount REAL,
  settlement_note TEXT,
  settled_at TEXT,
  reject_reason TEXT,
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES newhome_projects(id),
  FOREIGN KEY (registration_id) REFERENCES newhome_registrations(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (distribution_company_id) REFERENCES newhome_distribution_companies(id)
);

CREATE TABLE IF NOT EXISTS newhome_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_newhome_distribution_status
  ON newhome_distribution_companies(company_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_newhome_sales_store
  ON newhome_sales_reports(company_id, store_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_newhome_sales_agent
  ON newhome_sales_reports(company_id, agent_id, status);
CREATE INDEX IF NOT EXISTS idx_newhome_events_entity
  ON newhome_events(company_id, entity_type, entity_id, created_at);
