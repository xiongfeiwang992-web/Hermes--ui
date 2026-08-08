CREATE TABLE IF NOT EXISTS performance_point_rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  points REAL NOT NULL,
  applicable_role TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS performance_point_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rule_id TEXT,
  points REAL NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (rule_id) REFERENCES performance_point_rules(id)
);

CREATE TABLE IF NOT EXISTS performance_targets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  user_id TEXT,
  period_month TEXT NOT NULL,
  metric TEXT NOT NULL,
  target_value REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, store_id, user_id, period_month, metric)
);

CREATE TABLE IF NOT EXISTS performance_bonus_batches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  period_month TEXT NOT NULL,
  award_rate REAL NOT NULL,
  commission_base REAL NOT NULL DEFAULT 0,
  bonus_total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  paid_by TEXT,
  paid_at TEXT,
  payment_reference TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, store_id, period_month)
);

CREATE TABLE IF NOT EXISTS performance_bonus_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT,
  FOREIGN KEY (batch_id) REFERENCES performance_bonus_batches(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(batch_id, user_id)
);

CREATE TABLE IF NOT EXISTS performance_dividend_batches (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  period_month TEXT NOT NULL,
  pool_amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  total_points REAL NOT NULL DEFAULT 0,
  allocated_total REAL NOT NULL DEFAULT 0,
  paid_by TEXT,
  paid_at TEXT,
  payment_reference TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, period_month)
);

CREATE TABLE IF NOT EXISTS performance_dividend_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  points REAL NOT NULL,
  share_amount REAL NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES performance_dividend_batches(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(batch_id, user_id)
);

CREATE TABLE IF NOT EXISTS performance_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_performance_points_user
  ON performance_point_entries(company_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_performance_targets_period
  ON performance_targets(company_id, period_month, status);
CREATE INDEX IF NOT EXISTS idx_performance_bonus_period
  ON performance_bonus_batches(company_id, period_month, status);
CREATE INDEX IF NOT EXISTS idx_performance_dividend_period
  ON performance_dividend_batches(company_id, period_month, status);
