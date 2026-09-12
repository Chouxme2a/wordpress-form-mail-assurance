CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  site_limit INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activation_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  form_id TEXT,
  provider TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  account_id TEXT,
  site_id TEXT,
  properties TEXT NOT NULL DEFAULT '{}',
  anthony_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(name, created_at);
CREATE INDEX IF NOT EXISTS idx_sites_state ON sites(state, last_checked_at);
