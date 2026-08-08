CREATE TABLE IF NOT EXISTS recruitment_jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  title TEXT NOT NULL,
  target_role TEXT NOT NULL,
  headcount INTEGER NOT NULL,
  requirements TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recruitment_candidates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  interview_at TEXT,
  note TEXT,
  reject_reason TEXT,
  hired_user_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES recruitment_jobs(id),
  FOREIGN KEY (hired_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_recruitment_jobs_scope
  ON recruitment_jobs(company_id, store_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_scope
  ON recruitment_candidates(company_id, store_id, job_id, phone, status);
