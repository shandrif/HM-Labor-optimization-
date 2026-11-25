-- Staffing actions: transfers, promotions/moves and hires
CREATE TABLE actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('transfer','promote','hire')),
  from_branch TEXT REFERENCES branches(code),   -- NULL for hire
  from_role TEXT CHECK (from_role IN ('sm','tl','ba','ca','cl')),
  to_branch TEXT NOT NULL REFERENCES branches(code),
  to_role TEXT NOT NULL CHECK (to_role IN ('sm','tl','ba','ca','cl')),
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 100),
  employee TEXT,                                -- optional name / employee no.
  effective_date TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','completed','cancelled')),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,
  completed_at TEXT
);
CREATE INDEX idx_actions_status ON actions(status);
CREATE INDEX idx_actions_from ON actions(from_branch);
CREATE INDEX idx_actions_to ON actions(to_branch);
