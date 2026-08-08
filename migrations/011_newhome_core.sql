CREATE TABLE IF NOT EXISTS newhome_projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  property_type TEXT NOT NULL DEFAULT 'residential',
  protection_days INTEGER NOT NULL DEFAULT 30,
  contact_name TEXT,
  contact_phone TEXT,
  commission_rule TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS newhome_registrations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'registered',
  source TEXT,
  contact_name TEXT,
  registered_at TEXT NOT NULL,
  protect_until TEXT NOT NULL,
  arrived_at TEXT,
  arrival_note TEXT,
  arrival_attachment_id TEXT,
  invalidated_at TEXT,
  invalid_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES newhome_projects(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (arrival_attachment_id) REFERENCES file_attachments(id)
);

CREATE INDEX IF NOT EXISTS idx_newhome_registrations_project
  ON newhome_registrations(project_id, status, protect_until);
CREATE INDEX IF NOT EXISTS idx_newhome_registrations_customer
  ON newhome_registrations(company_id, customer_id, project_id, status);
