# HM Labor Optimization

Branch labor productivity app for Half Million. Compares **actual** vs **optimum** headcount per branch and
shows sales productivity per head.

**Live:** https://hm-labor.abidihaiderabidi72.workers.dev (Workers — use this one; some company networks block `*.pages.dev`)
· mirror: https://hm-labor.pages.dev (Pages). Both use the same D1 database and R2 bucket.

## How it calculates

| Metric | Formula |
|---|---|
| Headcount | SM + TL + BA + CA + CL (Store Manager, Team Leader, Barista, Cashier, Cleaner) |
| Actual productivity / head | ADS ÷ Actual headcount |
| Optimum productivity / head | ADS ÷ Optimum headcount |
| Change % | Optimum productivity ÷ Actual productivity − 1 (▲ over-staffed, ▼ under-staffed) |
| Net requirement | Optimum − Actual (positive = staff needed, negative = surplus) |

- **ADS** (average daily sales) is per branch master data, editable by Admin.
- **Actual headcount** comes from the latest weekly Headcount upload (Excel with a `Data` sheet, one row per employee).
- **Optimum headcount** is entered manually. Managers request changes; only Admin approves.

## Staffing actions

Transfers, promotions/moves and hires (the "Actions" block of the YR26 sheet).

| Type | Effect on headcount |
|---|---|
| Transfer | −n role at From branch, +n same role at To branch |
| Promote / Move | −n old role at branch, +n new role at same (or another) branch |
| Hire | +n role at branch |

Status flow: `pending` → `approved` / `rejected`; `approved` → `completed` / `cancelled`. Managers propose (with a reason),
only Admin approves; Admin-created actions are approved immediately.
**Projected headcount** = Actual + approved actions. Admin marks an action *completed* once it appears in a
headcount upload, which removes it from the projection so it is not counted twice. "Gap after actions" =
Optimum − Projected (replaces the sheet's Validation columns). The Actions page also suggests transfers from
surplus to short branches per role, same region first.

## Roles

| Role | Can |
|---|---|
| admin | Everything: approve optimum changes, edit optimum directly, upload headcount, edit branches, manage users |
| manager | View everything, request optimum changes and staffing actions |
| viewer | View only |

## Stack

- React + Vite frontend in `src/`
- Hono API in `server/app.ts`, served two ways:
  - Cloudflare **Workers** with static assets: `worker/index.ts`, config `wrangler.worker.jsonc`
  - Cloudflare **Pages Functions**: `functions/api/[[route]].ts`, config `wrangler.toml`
- Cloudflare **D1** (`hm-labor-db`, schema in `migrations/`)
- Cloudflare **R2** (`hm-labor-files`, original headcount uploads)

## Develop

```bash
npm install
npx wrangler d1 migrations apply hm-labor-db --local
npm run build && npx wrangler pages dev dist
```

## Deploy

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

```bash
npm run db:migrate   # apply new migrations to the remote D1
npm run deploy:worker  # build + deploy to Workers (workers.dev) — primary
npm run deploy         # build + deploy to Pages (pages.dev) — mirror
```

## Data loading

Business data is **not** stored in this repo. To (re)build seed SQL from the YR26 working sheet:

```bash
python3 -I scripts/build-seed.py "Labor Working Sheet - YR26.xlsx" seed/seed.sql
npx wrangler d1 execute hm-labor-db --remote --file seed/seed.sql
```

Create a user from the command line (e.g. a first admin):

```bash
node scripts/hash-password.mjs <username> "<Full Name>" admin '<password>' > seed/user.sql
npx wrangler d1 execute hm-labor-db --remote --file seed/user.sql
```

## Security & performance

- All SQL uses bound parameters (no string-built queries); staff search uses `instr()` (no LIKE wildcards).
- Sessions: random 256-bit token, stored hashed, `HttpOnly; Secure; SameSite=Strict`, 7-day expiry.
- Passwords: PBKDF2-SHA256, 100k iterations, per-user salt. Login throttling: 8 failures per account
  or 30 per IP within 15 min → 15 min lock.
- Cross-site requests with a foreign `Origin` are rejected; CSP, HSTS, no-framing and nosniff headers
  (`public/_headers` for pages and assets, middleware for the API). API responses are `no-store`.
- Role checks on the server for every write; viewers never receive employee names.
- Status changes (approve/reject/complete/cancel) are atomic, so double clicks can't double-apply.
- D1 lives in ENAM; the Worker uses Smart Placement and each page loads with one batched D1 round trip.
- Hashed assets are cached for a year; the Excel reader/writer load on demand.

Tests (local dev server only): `node tests/security.mjs <admin-password>` (62 checks: SQL injection,
auth bypass, privilege escalation, brute force, CSRF, XSS, path tampering, malformed input, headers)
and `node tests/load.cjs <admin-password>` (autocannon load test).
