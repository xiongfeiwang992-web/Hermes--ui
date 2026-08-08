CREATE TABLE IF NOT EXISTS office_exams (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  pass_score REAL NOT NULL DEFAULT 60,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_exam_attempts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score REAL NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted',
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (exam_id) REFERENCES office_exams(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS office_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT,
  title TEXT NOT NULL,
  location TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_event_signups (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'signed',
  signed_at TEXT NOT NULL,
  cancelled_at TEXT,
  UNIQUE(event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES office_events(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS office_workflows (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  reject_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS office_workflow_approvers (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  comment TEXT,
  acted_at TEXT,
  FOREIGN KEY (workflow_id) REFERENCES office_workflows(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS office_tickets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  ticket_type TEXT NOT NULL,
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'requested',
  remark TEXT,
  reject_reason TEXT,
  applicant_user_id TEXT NOT NULL,
  approved_by TEXT,
  issued_by TEXT,
  returned_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  issued_at TEXT,
  returned_at TEXT
);

CREATE TABLE IF NOT EXISTS office_work_summaries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  content TEXT NOT NULL,
  house_id TEXT,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  review_comment TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  submitted_at TEXT,
  reviewed_at TEXT,
  FOREIGN KEY (house_id) REFERENCES houses(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS office_circle_posts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  hidden_reason TEXT
);

CREATE TABLE IF NOT EXISTS office_call_records (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL,
  matched_house_id TEXT,
  matched_customer_id TEXT,
  note TEXT,
  called_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (matched_house_id) REFERENCES houses(id),
  FOREIGN KEY (matched_customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS office_collab_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_office_exams_status
  ON office_exams(company_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_office_events_status
  ON office_events(company_id, status, start_at);
CREATE INDEX IF NOT EXISTS idx_office_workflows_status
  ON office_workflows(company_id, store_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_office_tickets_status
  ON office_tickets(company_id, store_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_office_summaries_user
  ON office_work_summaries(company_id, user_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_office_circle_store
  ON office_circle_posts(company_id, store_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_office_calls_phone
  ON office_call_records(company_id, phone, called_at);
CREATE INDEX IF NOT EXISTS idx_office_collab_events
  ON office_collab_events(company_id, entity_type, entity_id, created_at);
