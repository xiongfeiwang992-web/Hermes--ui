ALTER TABLE houses ADD COLUMN lock_reason TEXT;
ALTER TABLE houses ADD COLUMN lock_until TEXT;

CREATE TABLE IF NOT EXISTS house_cooperations (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  partner_user_id TEXT,
  partner_name TEXT NOT NULL,
  partner_phone TEXT,
  share_ratio REAL,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (house_id) REFERENCES houses(id),
  FOREIGN KEY (partner_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS house_media (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  media_type TEXT NOT NULL,
  title TEXT NOT NULL,
  local_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (house_id) REFERENCES houses(id)
);

CREATE TABLE IF NOT EXISTS house_auction_profiles (
  house_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  court_name TEXT,
  case_no TEXT,
  starting_price REAL NOT NULL,
  reserve_price REAL,
  auction_start TEXT,
  auction_end TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (house_id) REFERENCES houses(id)
);

CREATE TABLE IF NOT EXISTS house_exclusive_profiles (
  house_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  agency_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  package_price REAL,
  commission_rule TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  remark TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (house_id) REFERENCES houses(id)
);

CREATE TABLE IF NOT EXISTS property_ext_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_house_cooperations_house
  ON house_cooperations(company_id, house_id, status);
CREATE INDEX IF NOT EXISTS idx_house_media_house
  ON house_media(company_id, house_id, media_type, status);
CREATE INDEX IF NOT EXISTS idx_property_ext_events_entity
  ON property_ext_events(company_id, entity_type, entity_id, created_at);
