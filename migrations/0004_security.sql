-- Login throttling (brute-force protection)
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,            -- "u:<username>" or "ip:<address>"
  fails INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL,
  locked_until TEXT
);
-- Faster lookups used by dashboard / approvals badges
CREATE INDEX IF NOT EXISTS idx_req_branch_status ON optimum_requests(branch_code, status);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
