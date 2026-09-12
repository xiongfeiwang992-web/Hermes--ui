PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_units (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  community_id TEXT NOT NULL,
  building TEXT NOT NULL DEFAULT '',
  unit_no TEXT NOT NULL DEFAULT '',
  room_no TEXT NOT NULL,
  area_size REAL,
  build_area REAL,
  orientation TEXT,
  remark TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, community_id, building, unit_no, room_no),
  FOREIGN KEY (community_id) REFERENCES communities(id)
);

CREATE INDEX IF NOT EXISTS idx_community_units_community
  ON community_units(company_id, community_id, status);
