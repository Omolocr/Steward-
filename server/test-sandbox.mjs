// Team quick entry (sandbox access): reserved test numbers sign in without an SMS code, only when SANDBOX_ACCESS=yes on made-up data.
// Run: node --no-warnings test-sandbox.mjs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const here = (f) => new URL(f, import.meta.url).pathname;
const clean = { ...process.env }; for (const k of Object.keys(clean)) if (/^(DEFAULT_CHURCH|BOOTSTRAP|DEVELOPERS|DB_FILE|MPESA_|SMS_|AT_|NODE_ENV|SANDBOX|PERSISTENT|ALLOW_|TOKEN_)/.test(k)) delete clean[k];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'church-sbx-'));
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
let ipN = 1;
const mk = (port) => async (method, p, token, body) => { ipN++; const r = await fetch(`http://localhost:${port}${p}`, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${Math.floor(ipN / 250)}.${ipN % 250}`, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const start = (port, env) => spawn('node', ['--no-warnings', here('./server.mjs')], { env: { ...clean, PORT: port, DATA_DIR: tmp(), TOKEN_SECRET: 'sbx-test-secret', TRUST_PROXY: '1', DEFAULT_CHURCH: 'Sandbox SDA Church', ...env }, stdio: 'ignore' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- a sandbox server
const s1 = start(18150, { SANDBOX_ACCESS: 'yes' }); await wait(1500);
const A = mk(18150);
try {
  const h = await A('GET', '/health'); ok('health says this is a sandbox', h.sandbox === true);
  const list = await A('GET', '/sandbox/numbers');
  const nums = list.numbers || [];
  ok('37 reserved numbers: 10 developers, 1 church admin, 21 leaders, 5 members', nums.length === 37 && nums.filter((n) => n.console === 'developer').length === 10 && nums.filter((n) => n.console === 'church_admin').length === 1 && nums.filter((n) => n.console === 'leader').length === 21 && nums.filter((n) => n.console === 'member').length === 5, String(nums.length));
  ok('all numbers are unique and in the reserved 0700 000 block', new Set(nums.map((n) => n.phone)).size === 37 && nums.every((n) => /^0700000\d{3}$/.test(n.phone)));

  // every developer number opens the developer console
  const devs = [];
  for (const n of nums.filter((x) => x.console === 'developer')) { const r = await A('POST', '/sandbox/enter', null, { phone: n.phone }); const me = await A('GET', '/dev/me', r.token); devs.push(me.developer && me.developer.phone === n.phone); }
  ok('all 10 team numbers enter the developer console with no code', devs.length === 10 && devs.every(Boolean));
  const dv = await A('POST', '/sandbox/enter', null, { phone: '0700000001' });
  const team = await A('GET', '/dev/team', dv.token); ok('they are on the team list (10 of 10)', team.active === 10 && team.limit === 10);

  // church admin console, every leader dashboard and members
  let good = 0, bad = [];
  for (const n of nums.filter((x) => x.console !== 'developer')) {
    const r = await A('POST', '/sandbox/enter', null, { phone: n.phone });
    const me = await A('GET', '/me', r.token);
    (me.user && me.user.role === n.role && me.user.roleStatus === 'approved' ? good++ : bad.push(n.role + ':' + JSON.stringify(me).slice(0, 80)));
  }
  ok('church admin, all 21 leader dashboards and 5 members enter with the right approved role', good === 27 && bad.length === 0, bad.join(' | '));
  const t1 = await A('POST', '/sandbox/enter', null, { phone: '0700000202' }), t2 = await A('POST', '/sandbox/enter', null, { phone: '0700000202' });
  ok('entering twice gives the same person, not a new one', (await A('GET', '/me', t1.token)).user.id === (await A('GET', '/me', t2.token)).user.id);
  const tre = await A('POST', '/sandbox/enter', null, { phone: '0700000' + String(201 + 1) }); // treasurer is the 2nd leader role
  { const a = await A('GET', '/records/payments', tre.token), b = await A('GET', '/finance/reconciliation?from=2026-01-01&to=2026-12-31', tre.token); ok('the treasurer number can use treasurer tools', a.status === 200 && b.status === 200, a.status + ' ' + b.status + ' ' + JSON.stringify(b).slice(0, 120)); }
  const adm = await A('POST', '/sandbox/enter', null, { phone: '0700000101' });
  ok('the church admin number reaches the Church Admin console', (await A('GET', '/admin/overview', adm.token)).status === 200 || (await A('GET', '/admin/members', adm.token)).status === 200, JSON.stringify(await A('GET', '/admin/members', adm.token)).slice(0, 100));

  // everything else still needs a code
  const x = await A('POST', '/sandbox/enter', null, { phone: '0712345678' }); ok('a normal phone number cannot use quick entry', x.status === 403);
  const y = await A('POST', '/sandbox/enter', null, { phone: '0700000999' }); ok('an unassigned number in the block cannot either', y.status === 403);
  const z = await A('POST', '/dev/login', null, { phone: '0700000001', code: '123456' }); ok('the normal developer login still demands a real code', z.status >= 400);
} finally { s1.kill(); }

// --- a normal server has no such door
const s2 = start(18151, {}); await wait(1500);
try {
  const B = mk(18151);
  const h = await B('GET', '/health'); ok('a normal server is not a sandbox', h.sandbox === false);
  ok('quick entry does not exist on a normal server', (await B('POST', '/sandbox/enter', null, { phone: '0700000001' })).status === 404 && (await B('GET', '/sandbox/numbers')).status === 404);
} finally { s2.kill(); }

// --- never together with real data
const prod = { NODE_ENV: 'production', DEFAULT_CHURCH: 'Real Church', TOKEN_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'africastalking', AT_USERNAME: 'u', AT_API_KEY: 'k', PORT: 18152, DATA_DIR: tmp() };
let r = spawnSync('node', ['--no-warnings', here('./server.mjs')], { env: { ...clean, ...prod, SANDBOX_ACCESS: 'yes', PERSISTENT_STORAGE: 'yes' }, encoding: 'utf8', timeout: 8000 });
ok('the server refuses sandbox access together with real-data storage', r.status === 1 && /SANDBOX_ACCESS/.test(r.stderr) && /real church data/.test(r.stderr), r.stderr);
const s3 = start(18153, { NODE_ENV: 'production', DEFAULT_CHURCH: 'Trial Church', TOKEN_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'africastalking', AT_USERNAME: 'u', AT_API_KEY: 'k', ALLOW_EPHEMERAL: 'yes', SANDBOX_ACCESS: 'yes' }); await wait(1500);
try { const C = mk(18153); const e = await C('POST', '/sandbox/enter', null, { phone: '0700000101' }); ok('a trial deployment (ALLOW_EPHEMERAL) can use quick entry', e.status === 200 && !!e.token, JSON.stringify(e)); } finally { s3.kill(); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
