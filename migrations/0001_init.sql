-- Users & sessions
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','viewer')),
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Branch master data (from the YR26 working sheet)
CREATE TABLE branches (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT,
  city TEXT,
  area_manager TEXT,
  ops_lead TEXT,
  working_hours REAL,
  ads REAL NOT NULL DEFAULT 0,       -- average daily sales
  atc REAL NOT NULL DEFAULT 0,       -- average transactions per day
  size_tier TEXT,                    -- L / M / S
  floors INTEGER,
  toilets INTEGER,
  store_type TEXT,                   -- DT / NDT
  budget_sm INTEGER NOT NULL DEFAULT 0,
  budget_tl INTEGER NOT NULL DEFAULT 0,
  budget_ba INTEGER NOT NULL DEFAULT 0,
  budget_ca INTEGER NOT NULL DEFAULT 0,
  budget_cl INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Optimum headcount (manual, admin-approved)
CREATE TABLE optimum (
  branch_code TEXT PRIMARY KEY REFERENCES branches(code) ON DELETE CASCADE,
  sm INTEGER NOT NULL DEFAULT 0,
  tl INTEGER NOT NULL DEFAULT 0,
  ba INTEGER NOT NULL DEFAULT 0,
  ca INTEGER NOT NULL DEFAULT 0,
  cl INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE optimum_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  branch_code TEXT NOT NULL REFERENCES branches(code) ON DELETE CASCADE,
  sm INTEGER NOT NULL, tl INTEGER NOT NULL, ba INTEGER NOT NULL, ca INTEGER NOT NULL, cl INTEGER NOT NULL,
  prev_sm INTEGER, prev_tl INTEGER, prev_ba INTEGER, prev_ca INTEGER, prev_cl INTEGER,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX idx_req_status ON optimum_requests(status);

-- Weekly headcount uploads (actual headcount)
CREATE TABLE headcount_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_label TEXT NOT NULL,
  file_key TEXT,
  file_name TEXT,
  employees INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE headcount (
  upload_id INTEGER NOT NULL REFERENCES headcount_uploads(id) ON DELETE CASCADE,
  branch_code TEXT NOT NULL,
  sm INTEGER NOT NULL DEFAULT 0,
  tl INTEGER NOT NULL DEFAULT 0,
  ba INTEGER NOT NULL DEFAULT 0,
  ca INTEGER NOT NULL DEFAULT 0,
  cl INTEGER NOT NULL DEFAULT 0,
  other INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (upload_id, branch_code)
);

-- Remembered mapping from headcount-file location names to branch codes
CREATE TABLE location_map (
  location TEXT PRIMARY KEY,
  branch_code TEXT,              -- NULL = ignore (non-branch location)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
