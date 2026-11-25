-- Staff roster captured from each headcount upload (for name suggestions)
CREATE TABLE employees (
  upload_id INTEGER NOT NULL REFERENCES headcount_uploads(id) ON DELETE CASCADE,
  emp_no TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT,
  role TEXT NOT NULL,              -- sm / tl / ba / ca / cl / other
  branch_code TEXT,                -- NULL when the location is not a branch
  location TEXT,
  joining_date TEXT,
  company TEXT,
  PRIMARY KEY (upload_id, emp_no)
);
CREATE INDEX idx_emp_branch ON employees(upload_id, branch_code, role);

-- Which employees an action is about (comma-separated employee numbers)
ALTER TABLE actions ADD COLUMN employee_nos TEXT;
