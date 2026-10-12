CREATE TABLE IF NOT EXISTS visits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  path       TEXT NOT NULL,
  ref        TEXT,
  referer    TEXT,
  ip         TEXT,
  org        TEXT,
  asn        INTEGER,
  city       TEXT,
  region     TEXT,
  country    TEXT,
  timezone   TEXT,
  user_agent TEXT,
  language   TEXT,
  is_bot     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS visits_ts ON visits (ts);
