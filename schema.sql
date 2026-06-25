-- D1 Database Schema for Keyword Rank Tracker

CREATE TABLE IF NOT EXISTS products (
  asin TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asin TEXT NOT NULL,
  date TEXT NOT NULL,
  rating REAL DEFAULT 4.5,
  review_count INTEGER DEFAULT 92,
  rank TEXT DEFAULT '',
  keyword TEXT NOT NULL,
  natural_pos TEXT DEFAULT '',
  ad_pos TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(asin, date, keyword),
  FOREIGN KEY (asin) REFERENCES products(asin)
);

CREATE INDEX IF NOT EXISTS idx_rankings_asin ON rankings(asin);
CREATE INDEX IF NOT EXISTS idx_rankings_date ON rankings(date);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('site_password', '123456789A');
