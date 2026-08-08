CREATE TABLE IF NOT EXISTS employee_contracts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  contract_no TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  probation_end_date TEXT,
  signed_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  remark TEXT,
  terminated_at TEXT,
  termination_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, contract_no),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS employee_contract_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES employee_contracts(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_contract_scope
  ON employee_contracts(company_id, store_id, user_id, status, end_date);
