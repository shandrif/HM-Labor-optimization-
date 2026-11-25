const autocannon = require('autocannon');
// Load test (needs: npm i -D autocannon). Run against a LOCAL dev server.
// Usage: BASE=http://127.0.0.1:8788 node tests/load.cjs <admin-password>
const base = process.env.BASE ?? 'http://127.0.0.1:8788', PW = process.argv[2];
const run = (o) => new Promise((res, rej) => autocannon(o, (e, r) => (e ? rej(e) : res(r))));
(async () => {
  const lr = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }) });
  const cookie = lr.headers.get('set-cookie').split(';')[0];
  const H = { cookie, 'content-type': 'application/json' };
  const tests = [
    ['GET  / (app shell)', { url: base + '/', connections: 50, duration: 15 }],
    ['GET  /api/dashboard (106 branches)', { url: base + '/api/dashboard', headers: H, connections: 50, duration: 15 }],
    ['GET  /api/branches/B37', { url: base + '/api/branches/B37', headers: H, connections: 50, duration: 15 }],
    ['GET  /api/employees (staff search)', { url: base + '/api/employees?branch=B37&role=ba', headers: H, connections: 50, duration: 15 }],
    ['GET  /api/pending (nav badge)', { url: base + '/api/pending', headers: H, connections: 50, duration: 15 }],
    ['POST /api/login (password hashing)', { url: base + '/api/login', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PW }), connections: 10, duration: 10 }],
    ['POST /api/actions (writes)', { url: base + '/api/actions', method: 'POST', headers: H, body: JSON.stringify({ type: 'hire', to_branch: 'B37', to_role: 'ba', qty: 1, reason: 'load test' }), connections: 20, duration: 10 }],
  ];
  console.log('endpoint'.padEnd(38), 'req/s'.padStart(7), 'p50 ms'.padStart(7), 'p99 ms'.padStart(7), 'errors'.padStart(7), 'non-2xx'.padStart(8));
  for (const [name, o] of tests) {
    const r = await run(o);
    console.log(name.padEnd(38), String(Math.round(r.requests.average)).padStart(7), String(r.latency.p50).padStart(7), String(r.latency.p99).padStart(7), String(r.errors + r.timeouts).padStart(7), String(r.non2xx).padStart(8));
  }
})();
