ALTER TABLE payments ADD COLUMN confirmed_by TEXT;
ALTER TABLE payments ADD COLUMN confirmed_at TEXT;
ALTER TABLE payments ADD COLUMN reject_reason TEXT;
