// Tests giving statements and the Treasurer's monthly report. Run: node --no-warnings test-reports.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-rep-'));
const PORT = 18090;
const srv = spawn('node', ['--no-warnings', new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'test', BOOTSTRAP: '0711000003:treasurer,0711000001:secretary' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const base = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + JSON.stringify(x).slice(0, 300))); };
const call = async (m, p, t, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
const login = async (phone, name, extra = {}) => { const o = await call('POST', '/auth/request-otp', null, { phone }); const v = await call('POST', '/auth/verify', null, { phone, code: o.devCode, profile: { name, idNumber: '1' + Math.floor(Math.random() * 1e7), church: 'Test SDA Church', ...extra } }); return v; };
try {
  const tre = await login('0711000003', 'Daniel Treasurer');
  const g1 = await login('0722000001', '=HYPERLINK("http://evil","x")');
  const g2 = await login('0722000002', 'Peter Kamau');
  const give = async (who, code, amount, rows) => { const p = await call('POST', '/records/payments', who.token, { mpesaCode: code, mpesaName: who.user.name, purpose: 'Giving', amount, allocations: rows }); const r = await call('POST', `/payments/${p.record.id}/receive`, tre.token, {}); return r; };
  const a = await give(g1, 'RAAAAAAAA1', 1000, [{ category: 'Tithe', percent: 10 }, { category: 'Offering', percent: 20 }, { category: 'Church Budget', percent: 70 }]);
  ok('setup: receipt issued', a.status === 200 && a.receipt, a);
  await give(g1, 'RAAAAAAAA2', 500, [{ category: 'Tithe', percent: 100 }]);
  await give(g2, 'RBBBBBBBB1', 300, [{ category: 'Offering', percent: 100 }]);
  const yr = new Date(Date.now() + 3 * 3600e3).getUTCFullYear(), mo = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);

  const s = await call('GET', `/statements/${yr}`, g1.token);
  ok('member sees own statement with correct total', s.status === 200 && s.total === 1500 && s.items.length === 2, s);
  ok('statement totals by purpose', s.byCategory && s.byCategory.Tithe === 600 && s.byCategory.Offering === 200 && s.byCategory['Church Budget'] === 700, s.byCategory);
  ok('statement text is printable and includes totals', /GIVING STATEMENT/.test(s.text) && /TOTAL GIVEN: KSh 1,500/.test(s.text), s.text);
  const sw = await call('GET', `/statements/${yr}?lang=sw`, g1.token);
  ok('Kiswahili statement', /TAARIFA YA UTOAJI/.test(sw.text) && /Zaka: KSh 600/.test(sw.text) && /JUMLA ILIYOTOLEWA: KSh 1,500/.test(sw.text), sw.text);
  ok('statement does not include other members', !/RBBBBBBBB1/.test(JSON.stringify(s)));
  const other = await call('GET', `/statements/${yr}?memberId=${g2.user.id}`, g1.token);
  ok('member cannot read another member\'s statement', other.status === 403, other);
  const byT = await call('GET', `/statements/${yr}?memberId=${g2.user.id}`, tre.token);
  ok('treasurer can read a member\'s statement', byT.status === 200 && byT.total === 300, byT);
  const empty = await call('GET', `/statements/${yr - 5}`, g1.token);
  ok('empty year says so', empty.status === 200 && empty.total === 0 && /No receipted giving/.test(empty.text), empty);
  ok('bad year refused', (await call('GET', '/statements/abc', g1.token)).status === 400);
  ok('statement needs sign-in', (await call('GET', `/statements/${yr}`)).status === 401);

  const r = await call('GET', `/reports/monthly/${mo}`, tre.token);
  ok('treasurer gets monthly report', r.status === 200 && r.count === 3 && r.total === 1800, r);
  const lines = r.csv.replace('﻿', '').trim().split('\r\n');
  ok('csv header has a column per purpose', lines[0] === 'Date,Receipt no,Member,M-Pesa code,Total (KSh),Church Budget,Offering,Tithe,Receipted by', lines[0]);
  ok('csv total row correct', lines.at(-1) === 'TOTAL,,,,1800,700,500,600,', lines.at(-1));
  ok('csv starts with BOM for Excel', r.csv.charCodeAt(0) === 0xfeff);
  ok('formula in a member name is neutralised', lines.some((l) => l.includes(`"'=HYPERLINK(""http://evil"",""x"")"`)), lines);
  ok('member cannot see the monthly report', (await call('GET', `/reports/monthly/${mo}`, g1.token)).status === 403);
  ok('bad month refused', (await call('GET', '/reports/monthly/2026-13', tre.token)).status === 400);
  const none = await call('GET', '/reports/monthly/2019-01', tre.token);
  ok('empty month gives header and zero total', none.status === 200 && none.count === 0 && none.total === 0, none);
  const sec = await login('0711000001', 'Ruth Secretary');
  ok('secretary cannot see money report', (await call('GET', `/reports/monthly/${mo}`, sec.token)).status === 403);

  // ---- dashboards: who can see the Welfare funds and the Church Building project
  const sec2 = await login('0711000001', 'Ruth Secretary');
  const mk = async (phone, name, role, extra = {}) => { const u = await login(phone, name, { role, ...extra }); await call('POST', `/users/${u.user.id}/role-decision`, sec2.token, { approve: true }); return u; };
  const clerk = await mk('0744000001', 'Clerk C', 'clerk'), el3 = await mk('0744000002', 'Elder Three', 'elder3'), camp = await mk('0744000003', 'Camp Chair', 'camp_chair');
  const pf = await mk('0744000004', 'Pathfinder Dir', 'pathfinder_leader', { groups: ['pathfinders'] }), edu = await mk('0744000005', 'Edu Head', 'education');
  await call('POST', '/records/welfare', tre.token, { fund: 'Burial and Benevolent Fund', kind: 'contribution', title: 'Test entry', amount: 100 });
  for (const [n, who] of [['clerk', clerk], ['elder 3', el3], ['camp chair', camp], ['pathfinder leader', pf], ['education head', edu]]) {
    const w = await call('GET', '/records/welfare', who.token); const pr = await call('GET', '/records/projects', who.token);
    ok(`${n} can see Welfare and the Building project`, w.status === 200 && w.records.length === 1 && pr.status === 200, w);
  }
  const wm = await call('GET', '/records/welfare', g2.token);
  ok('an ordinary member does not see Welfare entries', wm.status === 200 && wm.records.length === 0, wm);
  ok('an elder cannot add Welfare entries', (await call('POST', '/records/welfare', el3.token, { fund: 'Burial and Benevolent Fund', kind: 'contribution', title: 'x', amount: 1 })).status === 403);
  ok('a department head can plan their own activities', (await call('POST', '/records/activities', edu.token, { groupKey: 'education', title: 'Prize giving', date: '2026-12-01' })).status === 200);
  ok('a department head cannot plan another office\'s activities', (await call('POST', '/records/activities', edu.token, { groupKey: 'clerk', title: 'x', date: '2026-12-01' })).status === 403);
  ok('an elder can plan their own activities', (await call('POST', '/records/activities', el3.token, { groupKey: 'elder3', title: 'Visitation', date: '2026-12-02' })).status === 200);
  // ---- office records: each leader's own reports/plans; Pastor and Secretary can read all
  const pastor = await login('0711000002', 'Pastor P'); // not bootstrapped in this test, so acts as a member
  const rec = (who, office, title = 'Annual plan') => call('POST', '/records/office', who.token, { office, kind: 'plan', title, date: '2026-11-01', body: 'Details' });
  const o1 = await rec(edu, 'education');
  ok('a leader can add a record for their own office', o1.status === 200 && o1.record.office === 'education', o1);
  ok('a leader cannot add records for another office', (await rec(edu, 'clerk')).status === 403);
  ok('an ordinary member cannot add office records', (await rec(g2, 'education')).status === 403);
  ok('the owner sees their records', (await call('GET', '/records/office', edu.token)).records.length === 1);
  ok('another leader does not see them', (await call('GET', '/records/office', el3.token)).records.length === 0);
  ok('the Secretary can read every office', (await call('GET', '/records/office', sec2.token)).records.length === 1);
  ok('an ordinary member sees none', (await call('GET', '/records/office', g2.token)).records.length === 0);
  ok('another leader cannot archive it', (await call('POST', `/records/office/${o1.record.id}/archive`, el3.token, { reason: 'x' })).status === 403);
  ok('the owner can archive (not delete) it', (await call('POST', `/records/office/${o1.record.id}/archive`, edu.token, { reason: 'old' })).status === 200 && (await fetch(base + `/records/office/${o1.record.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + edu.token } })).status === 405);
  ok('reports are read-only', (await fetch(base + `/reports/monthly/${mo}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tre.token } })).status === 405);
} catch (e) { fail++; console.log('ERROR', e); }
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
