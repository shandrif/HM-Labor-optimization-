// Security test suite — run against a LOCAL dev server only (it locks test accounts).
// Needs local users: admin (password as arg), testmgr/testpass123 (manager), testview/viewpass123 (viewer).
// Usage: BASE=http://127.0.0.1:8788 node tests/security.mjs <admin-password>
const base = process.env.BASE ?? 'http://127.0.0.1:8788', PW = process.argv[2];
const results = []; const ok = (area, name, pass, detail = '') => results.push({ area, name, pass, detail });
async function req(path, { method = 'GET', cookie, json, headers = {}, raw } = {}) {
  const h = { ...headers }; if (cookie) h.cookie = cookie; if (json !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + path, { method, headers: h, body: raw ?? (json !== undefined ? JSON.stringify(json) : undefined), redirect: 'manual' });
  let body; const t = await r.text(); try { body = JSON.parse(t); } catch { body = t; }
  return { status: r.status, body, headers: r.headers, text: t };
}
async function login(u, p) { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const c = r.headers.get('set-cookie'); return { status: r.status, cookie: c ? c.split(';')[0] : null, setCookie: c }; }

const admin = await login('admin', PW), mgr = await login('testmgr', 'testpass123'), view = await login('testview', 'viewpass123');
ok('setup', 'logins', admin.status === 200 && mgr.status === 200 && view.status === 200);
const A = admin.cookie, M = mgr.cookie, V = view.cookie;
const usersBefore = (await req('/api/users', { cookie: A })).body.users.length;

// 1. SQL injection
for (const u of ["admin' OR '1'='1", "' OR 1=1--", "admin'--", "admin\"; DROP TABLE users;--"]) {
  const r = await login(u, "x' OR '1'='1"); ok('SQL injection', `login user=${u}`, r.status === 401, `HTTP ${r.status}`);
}
for (const q of ["%' OR 1=1--", "' UNION SELECT username,password_hash,salt,role,1,1,1 FROM users--", "%", "_"]) {
  const r = await req('/api/employees?branch=B56&role=tl&q=' + encodeURIComponent(q), { cookie: A });
  ok('SQL injection', `staff search q=${q}`, r.status === 200 && r.body.employees.length === 0, `HTTP ${r.status}, ${r.body.employees?.length} rows`);
}
for (const p of ["/api/branches/" + encodeURIComponent("B37' OR '1'='1"), "/api/requests?status=" + encodeURIComponent("all' OR '1'='1"), "/api/actions?branch=" + encodeURIComponent("x' OR '1'='1"), "/api/employees?role=" + encodeURIComponent("tl' OR '1'='1")]) {
  const r = await req(p, { cookie: A });
  const leaked = r.status === 200 && ((r.body.requests?.length ?? 0) > 0 || (r.body.actions?.length ?? 0) > 0 || (r.body.employees?.length ?? 0) > 0 || r.body.branch);
  ok('SQL injection', `URL ${decodeURIComponent(p)}`, !leaked && r.status !== 500, `HTTP ${r.status}`);
}
let r = await req('/api/actions', { method: 'POST', cookie: A, json: { type: 'hire', to_branch: "B37' OR '1'='1", to_role: 'ba', qty: 1 } });
ok('SQL injection', 'action with injected branch code', r.status === 400, `HTTP ${r.status}`);
r = await req('/api/users', { cookie: A }); ok('SQL injection', 'users table intact after attacks', r.body.users.length === usersBefore);

// 2. Authentication
for (const p of ['/api/dashboard', '/api/branches/B37', '/api/actions', '/api/employees', '/api/users', '/api/uploads', '/api/pending']) {
  const a = await req(p); const f = await req(p, { cookie: 'hm_session=' + 'a'.repeat(64) });
  ok('Authentication', `${p} without / with forged session`, a.status === 401 && f.status === 401, `${a.status}/${f.status}`);
}
r = await req('/api/logout', { method: 'POST', cookie: (await login('testmgr', 'testpass123')).cookie }); ok('Authentication', 'logout', r.status === 200);

// 3. Authorization / privilege escalation
const viewerDenied = [
  ['POST', '/api/branches/B37/optimum', { sm: 9, tl: 9, ba: 9, ca: 9, cl: 9, reason: 'x' }],
  ['POST', '/api/actions', { type: 'hire', to_branch: 'B37', to_role: 'ba', qty: 1, reason: 'x' }],
  ['GET', '/api/employees?branch=B37'], ['GET', '/api/users'], ['POST', '/api/users', { username: 'evil', name: 'e', role: 'admin', password: 'password123' }],
  ['PUT', '/api/branches/B37', { name: 'pwned', ads: 1 }], ['DELETE', '/api/uploads/1'], ['GET', '/api/location-map'],
];
for (const [m, p, j] of viewerDenied) { const x = await req(p, { method: m, cookie: V, json: j }); ok('Authorization', `viewer ${m} ${p}`, x.status === 403, `HTTP ${x.status}`); }
const mgrDenied = [
  ['POST', '/api/users', { username: 'evil2', name: 'e', role: 'admin', password: 'password123' }], ['PATCH', '/api/users/2', { role: 'admin' }],
  ['PUT', '/api/branches/B37', { name: 'pwned' }], ['DELETE', '/api/uploads/1'], ['GET', '/api/uploads/1/file'], ['POST', '/api/requests/1/approve', {}],
];
for (const [m, p, j] of mgrDenied) { const x = await req(p, { method: m, cookie: M, json: j }); ok('Authorization', `manager ${m} ${p}`, x.status === 403, `HTTP ${x.status}`); }
const adminAct = await req('/api/actions', { method: 'POST', cookie: A, json: { type: 'hire', to_branch: 'B37', to_role: 'ba', qty: 1 } });
r = await req(`/api/actions/${adminAct.body.id}/cancel`, { method: 'POST', cookie: M, json: {} }); ok('Authorization', "manager cancels someone else's action", r.status === 403, `HTTP ${r.status}`);
r = await req('/api/actions/' + adminAct.body.id + '/approve', { method: 'POST', cookie: M, json: {} }); ok('Authorization', 'manager approves action', r.status === 403, `HTTP ${r.status}`);
r = await req('/api/users/1', { method: 'PATCH', cookie: A, json: { role: 'viewer' } }); ok('Authorization', 'admin demotes self (lock-out guard)', r.status === 400, `HTTP ${r.status}`);
r = await req('/api/users', { method: 'POST', cookie: A, json: { username: 'x1', name: 'x', role: 'superadmin', password: 'password123' } }); ok('Authorization', 'create user with invented role', r.status === 400, `HTTP ${r.status}`);
const va = await req('/api/actions?status=all', { cookie: V }); ok('Data exposure', 'viewer sees no employee names on actions', va.body.actions.every(a => !a.employee || a.employee === 'Hidden'));

// 4. Brute force
let last; for (let i = 0; i < 9; i++) last = await login('testview', 'wrong-password-' + i);
const afterLock = await login('testview', 'viewpass123');
ok('Brute force', '9th wrong password is throttled', last.status === 429, `HTTP ${last.status}`);
ok('Brute force', 'correct password refused while locked', afterLock.status === 429, `HTTP ${afterLock.status}`);
ok('Brute force', 'other accounts unaffected', (await login('testmgr', 'testpass123')).status === 200);

// 5. CSRF
r = await req('/api/actions', { method: 'POST', cookie: A, json: { type: 'hire', to_branch: 'B37', to_role: 'ba', qty: 1 }, headers: { origin: 'https://evil.example' } });
ok('CSRF', 'cross-site POST with a valid session', r.status === 403, `HTTP ${r.status}`);
ok('CSRF', 'session cookie flags', /HttpOnly/i.test(admin.setCookie) && /Secure/i.test(admin.setCookie) && /SameSite=Strict/i.test(admin.setCookie), admin.setCookie.replace(/hm_session=\w+/, 'hm_session=…'));

// 6. Stored XSS payloads (rendered check happens in the browser step)
const xss = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
r = await req('/api/actions', { method: 'POST', cookie: A, json: { type: 'hire', to_branch: 'B37', to_role: 'ba', qty: 1, reason: xss, employee: xss } });
ok('XSS', 'payload stored as plain text', r.status === 200);

// 7. Path / ID tampering
for (const p of ['/api/uploads/..%2F..%2Fetc%2Fpasswd/file', '/api/uploads/999999/file', '/api/uploads/abc/file', '/api/branches/..%2F..%2Fusers']) {
  const x = await req(p, { cookie: A }); ok('Path/ID tampering', p, [400, 404].includes(x.status), `HTTP ${x.status}`);
}

// 8. Malformed input
r = await req('/api/actions', { method: 'POST', cookie: A, raw: '{"type": "hire",', headers: { 'content-type': 'application/json' } }); ok('Malformed input', 'broken JSON', r.status === 400, `HTTP ${r.status}`);
r = await req('/api/login', { method: 'POST', json: { username: { $ne: 1 }, password: ['x'] } }); ok('Malformed input', 'object/array instead of strings at login', r.status === 400, `HTTP ${r.status}`);
r = await req('/api/branches/B37/optimum', { method: 'POST', cookie: A, json: { sm: -5, tl: 1e9, ba: 'x', ca: 1.5, cl: null } }); ok('Malformed input', 'negative / huge / non-integer headcount', r.status === 400, `HTTP ${r.status}`);
r = await req('/api/actions', { method: 'POST', cookie: A, json: { type: 'hire', to_branch: 'B37', to_role: 'ba', qty: 100000 } }); ok('Malformed input', 'qty out of range', r.status === 400, `HTTP ${r.status}`);
r = await req('/api/login', { method: 'POST', json: { username: 'a'.repeat(5000), password: 'b'.repeat(100000) } }); ok('Malformed input', 'oversized login fields', r.status === 400, `HTTP ${r.status}`);

// 9. Headers
const idx = await fetch(base + '/'); const api = await req('/api/dashboard', { cookie: A });
ok('Headers', 'CSP on page', /frame-ancestors 'none'/.test(idx.headers.get('content-security-policy') || ''), (idx.headers.get('content-security-policy') || 'missing').slice(0, 60) + '…');
ok('Headers', 'no framing / no sniffing / HSTS on API', api.headers.get('x-frame-options') === 'DENY' && api.headers.get('x-content-type-options') === 'nosniff' && !!api.headers.get('strict-transport-security'));
ok('Headers', 'private API data not cached', api.headers.get('cache-control') === 'no-store');
const asset = (await (await fetch(base + '/')).text()).match(/\/assets\/[\w.-]+\.js/)[0]; const ah = await fetch(base + asset);
ok('Headers', 'hashed assets cached long-term', /immutable/.test(ah.headers.get('cache-control') || ''), ah.headers.get('cache-control'));

// 10. Error leakage
r = await req('/api/actions/1/approve', { method: 'POST', cookie: A, raw: 'not json', headers: { 'content-type': 'application/json' } });
ok('Info leak', 'errors carry no stack traces / SQL', !/\n\s+at |sqlite|SELECT |stack/i.test(r.text), r.text.slice(0, 80));

const by = {}; for (const x of results) (by[x.area] ??= []).push(x);
let pass = 0, fail = 0;
for (const [area, xs] of Object.entries(by)) { const f = xs.filter(x => !x.pass); pass += xs.length - f.length; fail += f.length;
  console.log(`${f.length ? 'FAIL' : 'PASS'}  ${area}: ${xs.length - f.length}/${xs.length}`); for (const x of f) console.log(`      ✗ ${x.name} — ${x.detail}`); }
console.log(`TOTAL ${pass} passed, ${fail} failed`);
