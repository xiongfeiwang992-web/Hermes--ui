CREATE TABLE IF NOT EXISTS customer_care_cases (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  deal_id TEXT,
  case_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  assignee_user_id TEXT,
  due_date TEXT,
  resolution TEXT,
  legal_case_no TEXT,
  court_name TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  closed_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (deal_id) REFERENCES deals(id),
  FOREIGN KEY (assignee_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS customer_care_tasks (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  case_id TEXT,
  task_type TEXT NOT NULL,
  purpose TEXT NOT NULL,
  assignee_user_id TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  satisfaction_score INTEGER,
  cancel_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (case_id) REFERENCES customer_care_cases(id),
  FOREIGN KEY (assignee_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS customer_care_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_care_cases_store
  ON customer_care_cases(company_id, store_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_customer_care_tasks_assignee
  ON customer_care_tasks(company_id, assignee_user_id, status, due_at);
