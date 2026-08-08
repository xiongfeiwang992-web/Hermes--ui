PRAGMA foreign_keys = ON;

ALTER TABLE houses ADD COLUMN property_type TEXT NOT NULL DEFAULT 'residential';
ALTER TABLE houses ADD COLUMN deal_mode TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE houses ADD COLUMN visibility TEXT NOT NULL DEFAULT 'store';
ALTER TABLE houses ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE houses ADD COLUMN locked_by TEXT;
ALTER TABLE houses ADD COLUMN locked_at TEXT;

ALTER TABLE customers ADD COLUMN is_confidential INTEGER NOT NULL DEFAULT 0;
ALTER TABLE follows ADD COLUMN follow_kind TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE deals ADD COLUMN loan_amount REAL;
ALTER TABLE deals ADD COLUMN loan_bank TEXT;
ALTER TABLE payments ADD COLUMN direction TEXT NOT NULL DEFAULT 'in';
ALTER TABLE payments ADD COLUMN confirmation_status TEXT NOT NULL DEFAULT 'confirmed';

CREATE TABLE IF NOT EXISTS house_role_holders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  role_type TEXT NOT NULL,
  user_id TEXT NOT NULL,
  protected_until TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(house_id, role_type, user_id)
);

CREATE INDEX IF NOT EXISTS idx_houses_property_type
  ON houses(company_id, store_id, property_type, status);
CREATE INDEX IF NOT EXISTS idx_house_role_holders
  ON house_role_holders(house_id, role_type, protected_until);
