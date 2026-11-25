import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export type Env = { DB: D1Database; FILES: R2Bucket };
type Role = "admin" | "manager" | "viewer";
type User = { id: number; username: string; name: string; role: Role };
type Vars = { user: User };

const ROLES = ["sm", "tl", "ba", "ca", "cl"] as const;
type Counts = Record<(typeof ROLES)[number], number>;

const SESSION_COOKIE = "hm_session";
const SESSION_DAYS = 7;
const PBKDF2_ITER = 100_000;

const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath("/api");

// ---------- crypto helpers ----------
const enc = new TextEncoder();
const toHex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

async function hashPassword(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: PBKDF2_ITER },
    key,
    256,
  );
  return toHex(bits);
}
const randomHex = (n: number) => toHex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => toHex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function audit(db: D1Database, userId: number | null, action: string, detail: unknown) {
  await db
    .prepare("INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)")
    .bind(userId, action, JSON.stringify(detail))
    .run();
}

function cleanCounts(body: any): Counts | null {
  const out = {} as Counts;
  for (const r of ROLES) {
    const v = Number(body?.[r]);
    if (!Number.isInteger(v) || v < 0 || v > 500) return null;
    out[r] = v;
  }
  return out;
}

// ---------- auth ----------
app.post("/login", async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>();
  if (!username || !password) return c.json({ error: "Username and password are required" }, 400);
  const u = await c.env.DB.prepare(
    "SELECT id, username, name, role, password_hash, salt, active FROM users WHERE username = ?",
  )
    .bind(username.trim())
    .first<any>();
  const hash = u ? await hashPassword(password, u.salt) : await hashPassword(password, "00");
  if (!u || !u.active || !safeEqual(hash, u.password_hash)) {
    return c.json({ error: "Invalid username or password" }, 401);
  }
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),
    c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(
      await sha256(token),
      u.id,
      expires.toISOString().replace("T", " ").slice(0, 19),
    ),
  ]);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    expires,
  });
  await audit(c.env.DB, u.id, "login", {});
  return c.json({ user: { id: u.id, username: u.username, name: u.name, role: u.role } });
});

app.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// Everything below requires a session
app.use("*", async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: "Not signed in" }, 401);
  const u = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`,
  )
    .bind(await sha256(token))
    .first<User>();
  if (!u) return c.json({ error: "Session expired" }, 401);
  c.set("user", u);
  await next();
});

const requireRole =
  (...roles: Role[]) =>
  async (c: any, next: () => Promise<void>) => {
    if (!roles.includes(c.get("user").role)) return c.json({ error: "Not allowed" }, 403);
    await next();
  };
const adminOnly = requireRole("admin");

app.get("/me", (c) => c.json({ user: c.get("user") }));

app.post("/me/password", async (c) => {
  const { current, next } = await c.req.json<{ current: string; next: string }>();
  if (!next || next.length < 8) return c.json({ error: "New password must be at least 8 characters" }, 400);
  const u = await c.env.DB.prepare("SELECT password_hash, salt FROM users WHERE id = ?")
    .bind(c.get("user").id)
    .first<any>();
  if (!safeEqual(await hashPassword(current ?? "", u.salt), u.password_hash))
    return c.json({ error: "Current password is wrong" }, 400);
  const salt = randomHex(16);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?")
    .bind(await hashPassword(next, salt), salt, c.get("user").id)
    .run();
  await audit(c.env.DB, c.get("user").id, "password_change", {});
  return c.json({ ok: true });
});

// ---------- dashboard data ----------
async function latestUploadId(db: D1Database) {
  const r = await db.prepare("SELECT id FROM headcount_uploads ORDER BY id DESC LIMIT 1").first<{ id: number }>();
  return r?.id ?? null;
}

app.get("/dashboard", async (c) => {
  const db = c.env.DB;
  const uploadId = await latestUploadId(db);
  const upload = uploadId
    ? await db
        .prepare(
          `SELECT h.id, h.period_label, h.file_name, h.employees, h.created_at, u.name AS uploaded_by
           FROM headcount_uploads h LEFT JOIN users u ON u.id = h.uploaded_by WHERE h.id = ?`,
        )
        .bind(uploadId)
        .first()
    : null;
  const { results } = await db
    .prepare(
      `SELECT b.*,
        o.sm AS opt_sm, o.tl AS opt_tl, o.ba AS opt_ba, o.ca AS opt_ca, o.cl AS opt_cl,
        h.sm AS act_sm, h.tl AS act_tl, h.ba AS act_ba, h.ca AS act_ca, h.cl AS act_cl, h.other AS act_other,
        (SELECT COUNT(*) FROM optimum_requests r WHERE r.branch_code = b.code AND r.status = 'pending') AS pending
       FROM branches b
       LEFT JOIN optimum o ON o.branch_code = b.code
       LEFT JOIN headcount h ON h.branch_code = b.code AND h.upload_id = ?
       WHERE b.active = 1
       ORDER BY b.region, b.code`,
    )
    .bind(uploadId ?? -1)
    .all();
  const { results: actions } = await db
    .prepare("SELECT id, type, from_branch, from_role, to_branch, to_role, qty FROM actions WHERE status = 'approved'")
    .all();
  return c.json({ upload, branches: results, actions });
});

app.get("/branches/:code", async (c) => {
  const db = c.env.DB;
  const code = c.req.param("code");
  const branch = await db.prepare("SELECT * FROM branches WHERE code = ?").bind(code).first();
  if (!branch) return c.json({ error: "Branch not found" }, 404);
  const optimum = await db
    .prepare(
      `SELECT o.*, u.name AS updated_by_name FROM optimum o LEFT JOIN users u ON u.id = o.updated_by
       WHERE o.branch_code = ?`,
    )
    .bind(code)
    .first();
  const { results: history } = await db
    .prepare(
      `SELECT h.*, up.period_label, up.created_at FROM headcount h JOIN headcount_uploads up ON up.id = h.upload_id
       WHERE h.branch_code = ? ORDER BY up.id DESC LIMIT 12`,
    )
    .bind(code)
    .all();
  const { results: requests } = await db
    .prepare(
      `SELECT r.*, ru.name AS requested_by_name, rv.name AS reviewed_by_name FROM optimum_requests r
       JOIN users ru ON ru.id = r.requested_by LEFT JOIN users rv ON rv.id = r.reviewed_by
       WHERE r.branch_code = ? ORDER BY r.id DESC LIMIT 20`,
    )
    .bind(code)
    .all();
  const { results: actions } = await db
    .prepare(
      `SELECT a.*, ru.name AS requested_by_name, rv.name AS reviewed_by_name FROM actions a
       JOIN users ru ON ru.id = a.requested_by LEFT JOIN users rv ON rv.id = a.reviewed_by
       WHERE a.from_branch = ? OR a.to_branch = ? ORDER BY a.id DESC LIMIT 50`,
    )
    .bind(code, code)
    .all();
  return c.json({ branch, optimum, history, requests, actions });
});

// Admin can edit branch master data (ADS, ATC, hours, tier, type, etc.)
app.put("/branches/:code", adminOnly, async (c) => {
  const code = c.req.param("code");
  const b = await c.req.json<any>();
  const num = (v: any) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  await c.env.DB.prepare(
    `UPDATE branches SET name = ?, region = ?, city = ?, area_manager = ?, ops_lead = ?, working_hours = ?,
       ads = ?, atc = ?, size_tier = ?, store_type = ?, active = ? WHERE code = ?`,
  )
    .bind(
      String(b.name ?? "").trim() || code,
      b.region ?? null,
      b.city ?? null,
      b.area_manager ?? null,
      b.ops_lead ?? null,
      num(b.working_hours),
      num(b.ads) ?? 0,
      num(b.atc) ?? 0,
      b.size_tier ?? null,
      b.store_type ?? null,
      b.active === false || b.active === 0 ? 0 : 1,
      code,
    )
    .run();
  await audit(c.env.DB, c.get("user").id, "branch_update", { code, ...b });
  return c.json({ ok: true });
});

// ---------- optimum: admin direct edit, others request ----------
async function applyOptimum(db: D1Database, code: string, n: Counts, userId: number) {
  await db
    .prepare(
      `INSERT INTO optimum (branch_code, sm, tl, ba, ca, cl, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(branch_code) DO UPDATE SET sm = excluded.sm, tl = excluded.tl, ba = excluded.ba,
         ca = excluded.ca, cl = excluded.cl, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
    .bind(code, n.sm, n.tl, n.ba, n.ca, n.cl, userId)
    .run();
}

app.post("/branches/:code/optimum", requireRole("admin", "manager"), async (c) => {
  const db = c.env.DB;
  const code = c.req.param("code");
  const body = await c.req.json<any>();
  const n = cleanCounts(body);
  if (!n) return c.json({ error: "Each role must be a whole number between 0 and 500" }, 400);
  const exists = await db.prepare("SELECT code FROM branches WHERE code = ?").bind(code).first();
  if (!exists) return c.json({ error: "Branch not found" }, 404);
  const prev = (await db.prepare("SELECT * FROM optimum WHERE branch_code = ?").bind(code).first<any>()) ?? {};
  const user = c.get("user");
  const reason = String(body.reason ?? "").slice(0, 1000);

  if (user.role === "admin") {
    await applyOptimum(db, code, n, user.id);
    await db
      .prepare(
        `INSERT INTO optimum_requests (branch_code, sm, tl, ba, ca, cl, prev_sm, prev_tl, prev_ba, prev_ca, prev_cl,
           reason, status, requested_by, reviewed_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, datetime('now'))`,
      )
      .bind(code, n.sm, n.tl, n.ba, n.ca, n.cl, prev.sm ?? null, prev.tl ?? null, prev.ba ?? null, prev.ca ?? null, prev.cl ?? null, reason, user.id, user.id)
      .run();
    await audit(db, user.id, "optimum_set", { code, ...n });
    return c.json({ ok: true, applied: true });
  }

  await db
    .prepare(
      `INSERT INTO optimum_requests (branch_code, sm, tl, ba, ca, cl, prev_sm, prev_tl, prev_ba, prev_ca, prev_cl,
         reason, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(code, n.sm, n.tl, n.ba, n.ca, n.cl, prev.sm ?? null, prev.tl ?? null, prev.ba ?? null, prev.ca ?? null, prev.cl ?? null, reason, user.id)
    .run();
  await audit(db, user.id, "optimum_request", { code, ...n });
  return c.json({ ok: true, applied: false });
});

app.get("/requests", async (c) => {
  const status = c.req.query("status") ?? "pending";
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, b.name AS branch_name, b.ads, ru.name AS requested_by_name, rv.name AS reviewed_by_name
     FROM optimum_requests r JOIN branches b ON b.code = r.branch_code
     JOIN users ru ON ru.id = r.requested_by LEFT JOIN users rv ON rv.id = r.reviewed_by
     WHERE (? = 'all' OR r.status = ?) ORDER BY r.id DESC LIMIT 200`,
  )
    .bind(status, status)
    .all();
  return c.json({ requests: results });
});

app.post("/requests/:id/:decision{approve|reject}", adminOnly, async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const decision = c.req.param("decision");
  const { note } = await c.req.json<{ note?: string }>().catch(() => ({ note: "" }));
  const r = await db.prepare("SELECT * FROM optimum_requests WHERE id = ?").bind(id).first<any>();
  if (!r) return c.json({ error: "Request not found" }, 404);
  if (r.status !== "pending") return c.json({ error: "Request was already reviewed" }, 409);
  const user = c.get("user");
  if (decision === "approve") await applyOptimum(db, r.branch_code, r, user.id);
  await db
    .prepare(
      "UPDATE optimum_requests SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = datetime('now') WHERE id = ?",
    )
    .bind(decision === "approve" ? "approved" : "rejected", user.id, String(note ?? "").slice(0, 1000), id)
    .run();
  await audit(db, user.id, `request_${decision}`, { id, code: r.branch_code });
  return c.json({ ok: true });
});

// ---------- headcount uploads (admin only) ----------
app.get("/uploads", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.period_label, h.file_name, h.file_key IS NOT NULL AS has_file, h.employees, h.created_at,
       u.name AS uploaded_by,
       (SELECT SUM(sm+tl+ba+ca+cl) FROM headcount x WHERE x.upload_id = h.id) AS branch_staff,
       (SELECT COUNT(*) FROM headcount x WHERE x.upload_id = h.id) AS branches
     FROM headcount_uploads h LEFT JOIN users u ON u.id = h.uploaded_by ORDER BY h.id DESC`,
  ).all();
  return c.json({ uploads: results });
});

app.get("/location-map", adminOnly, async (c) => {
  const { results } = await c.env.DB.prepare("SELECT location, branch_code FROM location_map").all();
  return c.json({ map: results });
});

type UploadRow = { location: string } & Counts & { other: number };
type StaffRow = {
  emp_no: string;
  name: string;
  title: string | null;
  role: string;
  location: string;
  joining_date: string | null;
  company: string | null;
};

app.post("/uploads", adminOnly, async (c) => {
  const db = c.env.DB;
  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  let payload: {
    period_label: string;
    employees: number;
    rows: UploadRow[];
    mappings: Record<string, string | null>;
    staff?: StaffRow[];
  };
  try {
    payload = JSON.parse(String(form.get("payload")));
  } catch {
    return c.json({ error: "Invalid upload payload" }, 400);
  }
  const label = String(payload.period_label ?? "").trim();
  if (!label) return c.json({ error: "Period label is required" }, 400);
  if (!Array.isArray(payload.rows) || payload.rows.length === 0) return c.json({ error: "No rows in upload" }, 400);

  const { results: codes } = await db.prepare("SELECT code FROM branches").all<{ code: string }>();
  const valid = new Set(codes.map((r) => r.code));
  const mappings = payload.mappings ?? {};
  for (const [loc, code] of Object.entries(mappings)) {
    if (code !== null && !valid.has(code)) return c.json({ error: `Unknown branch code ${code} for ${loc}` }, 400);
  }

  // Aggregate rows per branch (several locations may map to one branch)
  const agg = new Map<string, Counts & { other: number }>();
  for (const row of payload.rows) {
    const code = mappings[row.location];
    if (!code) continue;
    const a = agg.get(code) ?? { sm: 0, tl: 0, ba: 0, ca: 0, cl: 0, other: 0 };
    for (const r of [...ROLES, "other"] as const) a[r] += Math.max(0, Math.trunc(Number(row[r]) || 0));
    agg.set(code, a);
  }
  if (agg.size === 0) return c.json({ error: "No rows matched a branch" }, 400);

  let fileKey: string | null = null;
  if (file && file.size > 0) {
    if (file.size > 20 * 1024 * 1024) return c.json({ error: "File is larger than 20 MB" }, 400);
    fileKey = `headcount/${new Date().toISOString().slice(0, 10)}-${randomHex(6)}.xlsx`;
    await c.env.FILES.put(fileKey, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { originalName: file.name },
    });
  }

  const up = await db
    .prepare(
      "INSERT INTO headcount_uploads (period_label, file_key, file_name, employees, uploaded_by) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(label, fileKey, file?.name ?? null, Number(payload.employees) || 0, c.get("user").id)
    .first<{ id: number }>();
  const uploadId = up!.id;

  const stmts: D1PreparedStatement[] = [];
  for (const [code, a] of agg) {
    stmts.push(
      db
        .prepare("INSERT INTO headcount (upload_id, branch_code, sm, tl, ba, ca, cl, other) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(uploadId, code, a.sm, a.tl, a.ba, a.ca, a.cl, a.other),
    );
  }
  for (const [loc, code] of Object.entries(mappings)) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO location_map (location, branch_code, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(location) DO UPDATE SET branch_code = excluded.branch_code, updated_at = excluded.updated_at`,
        )
        .bind(loc, code),
    );
  }
  // staff roster: multi-row inserts (D1 allows up to 100 bound params per statement)
  const staff = Array.isArray(payload.staff) ? payload.staff.slice(0, 20000) : [];
  const COLS = 9, PER = Math.floor(100 / COLS);
  const str = (v: unknown, n: number) => (v == null || v === "" ? null : String(v).slice(0, n));
  for (let i = 0; i < staff.length; i += PER) {
    const chunk = staff.slice(i, i + PER).filter((e) => e && e.emp_no && e.name);
    if (!chunk.length) continue;
    const params: unknown[] = [];
    for (const e of chunk) {
      const role = (ROLES as readonly string[]).includes(e.role) ? e.role : "other";
      params.push(
        uploadId,
        str(e.emp_no, 40),
        str(e.name, 200),
        str(e.title, 120),
        role,
        mappings[e.location] ?? null,
        str(e.location, 200),
        /^\d{4}-\d{2}-\d{2}$/.test(String(e.joining_date)) ? e.joining_date : null,
        str(e.company, 120),
      );
    }
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO employees (upload_id, emp_no, name, title, role, branch_code, location, joining_date, company) VALUES ${chunk
            .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .join(", ")}`,
        )
        .bind(...params),
    );
  }
  await db.batch(stmts);
  await audit(db, c.get("user").id, "headcount_upload", { uploadId, label, branches: agg.size, staff: staff.length });
  return c.json({ ok: true, id: uploadId, branches: agg.size });
});

app.get("/uploads/:id/file", adminOnly, async (c) => {
  const row = await c.env.DB.prepare("SELECT file_key, file_name FROM headcount_uploads WHERE id = ?")
    .bind(Number(c.req.param("id")))
    .first<any>();
  if (!row?.file_key) return c.json({ error: "No file stored for this upload" }, 404);
  const obj = await c.env.FILES.get(row.file_key);
  if (!obj) return c.json({ error: "File missing from storage" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${(row.file_name ?? "headcount.xlsx").replace(/"/g, "")}"`,
    },
  });
});

app.delete("/uploads/:id", adminOnly, async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare("SELECT file_key FROM headcount_uploads WHERE id = ?").bind(id).first<any>();
  if (!row) return c.json({ error: "Upload not found" }, 404);
  if (row.file_key) await c.env.FILES.delete(row.file_key);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM headcount WHERE upload_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM employees WHERE upload_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM headcount_uploads WHERE id = ?").bind(id),
  ]);
  await audit(c.env.DB, c.get("user").id, "headcount_delete", { id });
  return c.json({ ok: true });
});

// ---------- staffing actions: transfers, promotions, hires ----------
const ACTION_TYPES = ["transfer", "promote", "hire"] as const;
const isRole = (r: unknown): r is (typeof ROLES)[number] => typeof r === "string" && (ROLES as readonly string[]).includes(r);

app.get("/actions", async (c) => {
  const status = c.req.query("status") ?? "open";
  const branch = c.req.query("branch") ?? "";
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, fb.name AS from_branch_name, tb.name AS to_branch_name,
       ru.name AS requested_by_name, rv.name AS reviewed_by_name
     FROM actions a
     LEFT JOIN branches fb ON fb.code = a.from_branch
     JOIN branches tb ON tb.code = a.to_branch
     JOIN users ru ON ru.id = a.requested_by LEFT JOIN users rv ON rv.id = a.reviewed_by
     WHERE (? = 'all' OR (? = 'open' AND a.status IN ('pending','approved')) OR a.status = ?)
       AND (? = '' OR a.from_branch = ? OR a.to_branch = ?)
     ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, a.id DESC LIMIT 500`,
  )
    .bind(status, status, status, branch, branch, branch)
    .all();
  return c.json({ actions: results });
});

app.post("/actions", requireRole("admin", "manager"), async (c) => {
  const db = c.env.DB;
  const b = await c.req.json<any>();
  const user = c.get("user");
  const type = b.type;
  if (!ACTION_TYPES.includes(type)) return c.json({ error: "Invalid action type" }, 400);
  const qty = Number(b.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 100) return c.json({ error: "Number of staff must be 1–100" }, 400);

  let fromBranch: string | null = null, fromRole: string | null = null, toBranch: string, toRole: string;
  if (type === "hire") {
    toBranch = b.to_branch; toRole = b.to_role;
  } else if (type === "transfer") {
    fromBranch = b.from_branch; toBranch = b.to_branch; fromRole = toRole = b.from_role ?? b.to_role;
    if (fromBranch === toBranch) return c.json({ error: "From and To branch must be different" }, 400);
  } else {
    fromBranch = b.from_branch; fromRole = b.from_role; toRole = b.to_role;
    toBranch = b.to_branch || b.from_branch;
    if (fromRole === toRole && fromBranch === toBranch) return c.json({ error: "Choose a different role or branch" }, 400);
  }
  if (!isRole(toRole) || (fromRole !== null && !isRole(fromRole))) return c.json({ error: "Invalid role" }, 400);
  const codes = [toBranch, fromBranch].filter(Boolean) as string[];
  for (const code of codes) {
    if (!(await db.prepare("SELECT 1 FROM branches WHERE code = ?").bind(code).first()))
      return c.json({ error: `Unknown branch ${code}` }, 400);
  }
  const date = String(b.effective_date ?? "").trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "Invalid effective date" }, 400);
  const isAdmin = user.role === "admin";
  if (!isAdmin && !String(b.reason ?? "").trim()) return c.json({ error: "Please give a reason" }, 400);

  const row = await db
    .prepare(
      `INSERT INTO actions (type, from_branch, from_role, to_branch, to_role, qty, employee, employee_nos, effective_date, reason,
         status, requested_by, reviewed_by, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${isAdmin ? "datetime('now')" : "NULL"}) RETURNING id`,
    )
    .bind(
      type, fromBranch, fromRole, toBranch, toRole, qty,
      String(b.employee ?? "").trim().slice(0, 1000) || null,
      Array.isArray(b.employee_nos)
        ? b.employee_nos.map((x: unknown) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 100).join(",") || null
        : null,
      date || null,
      String(b.reason ?? "").trim().slice(0, 1000) || null,
      isAdmin ? "approved" : "pending",
      user.id,
      isAdmin ? user.id : null,
    )
    .first<{ id: number }>();
  await audit(db, user.id, "action_create", { id: row?.id, type, fromBranch, toBranch, fromRole, toRole, qty });
  return c.json({ ok: true, id: row?.id, approved: isAdmin });
});

const TRANSITIONS: Record<string, { from: string[]; to: string; admin: boolean }> = {
  approve: { from: ["pending"], to: "approved", admin: true },
  reject: { from: ["pending"], to: "rejected", admin: true },
  complete: { from: ["approved"], to: "completed", admin: true },
  cancel: { from: ["pending", "approved"], to: "cancelled", admin: false },
};

app.post("/actions/:id/:op{approve|reject|complete|cancel}", requireRole("admin", "manager"), async (c) => {
  const db = c.env.DB;
  const id = Number(c.req.param("id"));
  const op = c.req.param("op");
  const t = TRANSITIONS[op];
  const user = c.get("user");
  const a = await db.prepare("SELECT * FROM actions WHERE id = ?").bind(id).first<any>();
  if (!a) return c.json({ error: "Action not found" }, 404);
  if (t.admin && user.role !== "admin") return c.json({ error: "Only Admin can do this" }, 403);
  // managers may only cancel their own pending requests
  if (op === "cancel" && user.role !== "admin" && (a.requested_by !== user.id || a.status !== "pending"))
    return c.json({ error: "You can only cancel your own pending requests" }, 403);
  if (!t.from.includes(a.status)) return c.json({ error: `Cannot ${op} an action that is ${a.status}` }, 409);
  const { note } = await c.req.json<{ note?: string }>().catch(() => ({ note: "" }));
  await db
    .prepare(
      `UPDATE actions SET status = ?, reviewed_by = COALESCE(?, reviewed_by), review_note = COALESCE(NULLIF(?, ''), review_note),
         reviewed_at = CASE WHEN ? IN ('approve','reject') THEN datetime('now') ELSE reviewed_at END,
         completed_at = CASE WHEN ? = 'complete' THEN datetime('now') ELSE completed_at END
       WHERE id = ?`,
    )
    .bind(t.to, op === "approve" || op === "reject" ? user.id : null, String(note ?? "").slice(0, 1000), op, op, id)
    .run();
  await audit(db, user.id, `action_${op}`, { id });
  return c.json({ ok: true });
});

// ---------- staff roster (admin + manager only) ----------
app.get("/employees", requireRole("admin", "manager"), async (c) => {
  const db = c.env.DB;
  const branch = c.req.query("branch") ?? "";
  const role = c.req.query("role") ?? "";
  const q = (c.req.query("q") ?? "").trim();
  const latest = await db
    .prepare("SELECT u.id, u.period_label FROM headcount_uploads u WHERE EXISTS (SELECT 1 FROM employees e WHERE e.upload_id = u.id) ORDER BY u.id DESC LIMIT 1")
    .first<{ id: number; period_label: string }>();
  if (!latest) return c.json({ employees: [], source: null });
  const { results } = await db
    .prepare(
      `SELECT emp_no, name, title, role, branch_code, joining_date, company FROM employees
       WHERE upload_id = ? AND (? = '' OR branch_code = ?) AND (? = '' OR role = ?)
         AND (? = '' OR name LIKE ? OR emp_no LIKE ?)
       ORDER BY name LIMIT 200`,
    )
    .bind(latest.id, branch, branch, role, role, q, `%${q}%`, `%${q}%`)
    .all<any>();
  // flag staff already named in an open action
  const { results: open } = await db
    .prepare("SELECT id, type, status, employee_nos FROM actions WHERE status IN ('pending','approved') AND employee_nos IS NOT NULL")
    .all<any>();
  const busy = new Map<string, { id: number; type: string; status: string }>();
  for (const a of open) for (const n of String(a.employee_nos).split(",")) if (n) busy.set(n.trim(), a);
  return c.json({
    source: latest.period_label,
    employees: results.map((e) => ({ ...e, in_action: busy.get(e.emp_no) ?? null })),
  });
});

// ---------- users (admin only) ----------
app.get("/users", adminOnly, async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, username, name, role, active, created_at FROM users ORDER BY name",
  ).all();
  return c.json({ users: results });
});

app.post("/users", adminOnly, async (c) => {
  const b = await c.req.json<any>();
  const username = String(b.username ?? "").trim();
  const name = String(b.name ?? "").trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) return c.json({ error: "Username: 3–40 letters, numbers, . _ -" }, 400);
  if (!name) return c.json({ error: "Name is required" }, 400);
  if (!["admin", "manager", "viewer"].includes(b.role)) return c.json({ error: "Invalid role" }, 400);
  if (!b.password || String(b.password).length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
  const salt = randomHex(16);
  try {
    await c.env.DB.prepare("INSERT INTO users (username, name, role, password_hash, salt) VALUES (?, ?, ?, ?, ?)")
      .bind(username, name, b.role, await hashPassword(String(b.password), salt), salt)
      .run();
  } catch {
    return c.json({ error: "Username already exists" }, 409);
  }
  await audit(c.env.DB, c.get("user").id, "user_create", { username, role: b.role });
  return c.json({ ok: true });
});

app.patch("/users/:id", adminOnly, async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<any>();
  const me = c.get("user");
  if (id === me.id && (b.role && b.role !== "admin" || b.active === false))
    return c.json({ error: "You cannot remove your own admin access" }, 400);
  const stmts: D1PreparedStatement[] = [];
  if (b.role) {
    if (!["admin", "manager", "viewer"].includes(b.role)) return c.json({ error: "Invalid role" }, 400);
    stmts.push(c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(b.role, id));
  }
  if (typeof b.active === "boolean") {
    stmts.push(c.env.DB.prepare("UPDATE users SET active = ? WHERE id = ?").bind(b.active ? 1 : 0, id));
    if (!b.active) stmts.push(c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  }
  if (b.password) {
    if (String(b.password).length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
    const salt = randomHex(16);
    stmts.push(
      c.env.DB.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").bind(
        await hashPassword(String(b.password), salt),
        salt,
        id,
      ),
    );
    stmts.push(c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env.DB, me.id, "user_update", { id, role: b.role, active: b.active, password: !!b.password });
  return c.json({ ok: true });
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Server error" }, 500);
});

export default app;
