ALTER TABLE customers ADD COLUMN invalid_reason TEXT;
ALTER TABLE customers ADD COLUMN invalidated_at TEXT;
ALTER TABLE customers ADD COLUMN invalidated_by TEXT;
ALTER TABLE settings ADD COLUMN customer_void_keywords TEXT NOT NULL DEFAULT '[]';
ALTER TABLE settings ADD COLUMN customer_void_hit_count INTEGER NOT NULL DEFAULT 0;
