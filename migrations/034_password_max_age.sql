ALTER TABLE settings ADD COLUMN password_max_age_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
UPDATE users SET password_changed_at = created_at WHERE password_changed_at IS NULL;
