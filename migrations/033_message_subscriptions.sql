CREATE TABLE IF NOT EXISTS message_subscriptions (
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_message_subscriptions_user
  ON message_subscriptions(company_id, user_id);
