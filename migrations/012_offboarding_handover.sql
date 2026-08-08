CREATE TABLE IF NOT EXISTS offboarding_tasks (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL,
  house_count INTEGER NOT NULL DEFAULT 0,
  customer_count INTEGER NOT NULL DEFAULT 0,
  key_count INTEGER NOT NULL DEFAULT 0,
  role_count INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  cancel_reason TEXT,
  completed_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (target_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_offboarding_tasks_user
  ON offboarding_tasks(company_id, store_id, user_id, status);
