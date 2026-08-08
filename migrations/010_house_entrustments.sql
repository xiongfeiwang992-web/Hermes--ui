CREATE TABLE IF NOT EXISTS house_entrustments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  house_id TEXT NOT NULL,
  entrust_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  signed_at TEXT,
  attachment_id TEXT,
  terminated_at TEXT,
  terminate_reason TEXT,
  remark TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (house_id) REFERENCES houses(id),
  FOREIGN KEY (attachment_id) REFERENCES file_attachments(id)
);

CREATE INDEX IF NOT EXISTS idx_house_entrustments_house
  ON house_entrustments(house_id, status, end_at);
