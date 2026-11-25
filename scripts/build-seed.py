"""Build seed SQL from the YR26 Labor Working Sheet.

Usage: python3 -I scripts/build-seed.py <yr26.xlsx> <out.sql>
Output contains business data — keep it out of git (seed/ is gitignored).
"""
import sys
import openpyxl

src, out = sys.argv[1], sys.argv[2]
ws = openpyxl.load_workbook(src, data_only=True).active

def col(letter):
    return openpyxl.utils.column_index_from_string(letter)

def val(r, c):
    return ws.cell(r, col(c)).value

def q(v):
    if v is None or (isinstance(v, str) and not v.strip()):
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + " ".join(str(v).split()).replace("'", "''") + "'"

def i(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0

ROLE_COLS = {  # SM, TL, BA, CA, CL
    "budget": ["R", "S", "T", "U", "V"],
    "actual": ["Y", "Z", "AA", "AB", "AC"],
    "optimum": ["AF", "AG", "AH", "AI", "AJ"],
}

lines, seen = [], set()
branches = optimum = actual = 0
lines.append("INSERT INTO headcount_uploads (id, period_label, file_name, employees) VALUES (1, 'YR26 working sheet (baseline)', NULL, 0);")
for r in range(7, 124):
    code = val(r, "C")
    if not code or not str(code).strip():
        continue
    code = str(code).strip()
    if code in seen:
        print("duplicate code", code, file=sys.stderr)
        continue
    seen.add(code)
    import re
    raw = " ".join(str(val(r, "B") or code).split())
    # names in the sheet repeat the code ("B26 Buraidah, Rehab", "123 Jeaddh Ubhor") — drop it
    name = re.sub(r"^(B?0*%s)\s*[-,:،]?\s*" % re.escape(code.lstrip("Bb").lstrip("0") or code), "", raw, flags=re.I).strip() or raw
    b = [i(val(r, c)) for c in ROLE_COLS["budget"]]
    lines.append(
        "INSERT INTO branches (code, name, region, city, area_manager, ops_lead, working_hours, ads, atc, size_tier, floors, toilets, store_type, "
        "budget_sm, budget_tl, budget_ba, budget_ca, budget_cl) VALUES ("
        + ", ".join([q(code), q(name), q(val(r, "D")), q(val(r, "E")), q(val(r, "F")), q(val(r, "G")), q(val(r, "H")),
                     q(round(float(val(r, "I") or 0), 2)), q(round(float(val(r, "J") or 0), 2)), q(val(r, "M")),
                     q(val(r, "N")), q(val(r, "O")), q(val(r, "P"))] + [str(x) for x in b])
        + ");"
    )
    branches += 1
    o = [val(r, c) for c in ROLE_COLS["optimum"]]
    if any(v not in (None, "") for v in o):
        lines.append(f"INSERT INTO optimum (branch_code, sm, tl, ba, ca, cl) VALUES ({q(code)}, " + ", ".join(str(i(v)) for v in o) + ");")
        optimum += 1
    a = [val(r, c) for c in ROLE_COLS["actual"]]
    if any(v not in (None, "") for v in a):
        lines.append(f"INSERT INTO headcount (upload_id, branch_code, sm, tl, ba, ca, cl) VALUES (1, {q(code)}, " + ", ".join(str(i(v)) for v in a) + ");")
        actual += 1

open(out, "w").write("\n".join(lines) + "\n")
print(f"branches={branches} optimum={optimum} actual={actual}")
