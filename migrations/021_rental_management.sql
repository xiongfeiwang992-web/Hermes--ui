CREATE TABLE IF NOT EXISTS rental_properties (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  management_type TEXT NOT NULL,
  manager_user_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  owner_payment REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  termination_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, house_id),
  FOREIGN KEY (house_id) REFERENCES houses(id),
  FOREIGN KEY (manager_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rental_leases (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  tenant_phone TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  monthly_rent REAL NOT NULL,
  deposit_amount REAL NOT NULL DEFAULT 0,
  payment_cycle_months INTEGER NOT NULL DEFAULT 1,
  first_due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  activated_by TEXT,
  activated_at TEXT,
  terminated_by TEXT,
  terminated_at TEXT,
  termination_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (property_id) REFERENCES rental_properties(id)
);

CREATE TABLE IF NOT EXISTS rental_bills (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_amount REAL,
  payment_method TEXT,
  payment_reference TEXT,
  paid_by TEXT,
  paid_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(lease_id, period_start),
  FOREIGN KEY (lease_id) REFERENCES rental_leases(id)
);

CREATE TABLE IF NOT EXISTS rental_work_orders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  lease_id TEXT,
  work_type TEXT NOT NULL,
  description TEXT NOT NULL,
  assignee_user_id TEXT NOT NULL,
  expected_cost REAL NOT NULL DEFAULT 0,
  actual_cost REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  completion_note TEXT,
  cancel_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (property_id) REFERENCES rental_properties(id),
  FOREIGN KEY (lease_id) REFERENCES rental_leases(id),
  FOREIGN KEY (assignee_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS rental_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rental_properties_store
  ON rental_properties(company_id, store_id, status);
CREATE INDEX IF NOT EXISTS idx_rental_leases_property
  ON rental_leases(property_id, status, start_date);
CREATE INDEX IF NOT EXISTS idx_rental_bills_due
  ON rental_bills(company_id, store_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_rental_work_orders_property
  ON rental_work_orders(property_id, status);
