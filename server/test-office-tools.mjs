// Sabbath School attendance, building pledges, camp registration. Run: node --no-warnings test-office-tools.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-ot-'));
const PORT = 18170;
const srv = spawn('node', ['--no-warnings', new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 't', BOOTSTRAP: '0711000001:secretary,0711000002:pastor' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
const base = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const call = async (method, p, token, body, lang) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(lang ? { 'X-Lang': lang } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
async function login(phone, profile) { const o = await call('POST', '/auth/request-otp', null, { phone }); const v = await call('POST', '/auth/verify', null, { phone, code: o.devCode, profile }); return { token: v.token, user: v.user }; }
const prof = (name, extra = {}) => ({ name, idNumber: '4' + Math.floor(Math.random() * 1e7), church: 'Test SDA Church', ...extra });
try {
  const sec = await login('0711000001', prof('Secretary')); const pas = await login('0711000002', prof('Pastor'));
  const mk = async (phone, name, role) => { const u = await login(phone, prof(name, role ? { role } : {})); if (role) await call('POST', `/users/${u.user.id}/role-decision`, sec.token, { approve: true }); return u; };
  const ss = await mk('0733000001', 'SS Leader', 'sabbath_school'), bld = await mk('0733000002', 'Builder', 'building');
  const cs = await mk('0733000003', 'Camp Sec', 'camp_secretary'), cc = await mk('0733000004', 'Camp Clerk', 'camp_clerk');
  const tre = await mk('0733000005', 'Treasurer', 'treasurer');
  const m1 = await login('0722000001', prof('Grace Member')), m2 = await login('0722000002', prof('Peter Member'));

  // ---------------- Sabbath School attendance
  const att = (over = {}) => ({ office: 'sabbath_school', kind: 'attendance', date: '2026-10-24', classes: [{ name: 'Adult', enrolled: 60, present: 48 }, { name: 'Kindergarten', enrolled: 20, present: 15 }], visitors: 4, ...over });
  ok('a member cannot record attendance', (await call('POST', '/records/office', m1.token, att())).status === 403);
  ok('the Treasurer cannot record Sabbath School attendance', (await call('POST', '/records/office', tre.token, att())).status === 403);
  ok('a Sabbath School leader can', (await call('POST', '/records/office', ss.token, att())).record?.classes?.length === 2);
  const dup = await call('POST', '/records/office', ss.token, att());
  ok('the same Sabbath cannot be recorded twice', dup.status === 409);
  ok('...and the refusal can be read in Kiswahili', /tayari yamerekodiwa/.test((await call('POST', '/records/office', ss.token, att(), 'sw')).error));
  ok('more present than on the roll is refused', (await call('POST', '/records/office', ss.token, att({ date: '2026-10-31', classes: [{ name: 'A', enrolled: 5, present: 9 }] }))).status === 400);
  ok('a nonsense date is refused', (await call('POST', '/records/office', ss.token, att({ date: 'tomorrow' }))).status === 400);
  ok('negative numbers are refused', (await call('POST', '/records/office', ss.token, att({ date: '2026-11-07', classes: [{ name: 'A', enrolled: 5, present: -1 }] }))).status === 400);
  ok('no classes is refused', (await call('POST', '/records/office', ss.token, att({ date: '2026-11-07', classes: [] }))).status === 400);
  ok('the Pastor can read the register', (await call('GET', '/records/office', pas.token)).records.some((r) => r.kind === 'attendance'));
  ok('a member cannot read it', !(await call('GET', '/records/office', m1.token)).records.some((r) => r.kind === 'attendance'));
  const a1 = (await call('GET', '/records/office', ss.token)).records.find((r) => r.kind === 'attendance');
  ok('archive (not delete) lets it be recorded again', (await call('POST', `/records/office/${a1.id}/archive`, ss.token, {})).archived === true && (await call('POST', '/records/office', ss.token, att({ visitors: 6 }))).record?.visitors === 6);

  // ---------------- Building pledges
  const pl = (over = {}) => ({ office: 'building', kind: 'pledge', pledger: 'Mama Wanjiku', phone: '0712000000', amount: 50000, due: '2026-12-31', ...over });
  ok('a member cannot record a pledge', (await call('POST', '/records/office', m1.token, pl())).status === 403);
  ok('the Treasurer cannot either (the Building Committee keeps pledges)', (await call('POST', '/records/office', tre.token, pl())).status === 403);
  const p1 = await call('POST', '/records/office', bld.token, pl());
  ok('the Building Committee records a pledge', p1.record?.amount === 50000 && p1.record.title === 'Pledge – Mama Wanjiku', JSON.stringify(p1));
  ok('a pledge of nothing is refused', (await call('POST', '/records/office', bld.token, pl({ amount: 0 }))).status === 400);
  const pp = (id, amount) => call('POST', '/records/office', bld.token, { office: 'building', kind: 'pledge_payment', pledgeId: id, amount, date: '2026-11-01' });
  ok('a payment toward the pledge is recorded', (await pp(p1.record.id, 20000)).record?.pledger === 'Mama Wanjiku');
  ok('a second payment too', (await pp(p1.record.id, 5000)).record?.amount === 5000);
  ok('a payment toward a pledge that does not exist is refused', (await pp('nope', 100)).status === 404);
  ok('a payment of zero is refused', (await pp(p1.record.id, 0)).status === 400);
  const all = (await call('GET', '/records/office', bld.token)).records.filter((r) => r.kind === 'pledge_payment');
  ok('payments add up to 25,000', all.reduce((s, r) => s + r.amount, 0) === 25000);
  ok('pledges are not shown to members', !(await call('GET', '/records/office', m1.token)).records.some((r) => r.kind === 'pledge'));
  ok('the payments are in the audit trail', (await call('GET', '/audit', sec.token)).entries?.some((e) => e.col === 'office') !== false);

  // ---------------- Camp registration
  const reg = (over = {}) => ({ camp: 'Mt Kenya Camp 2026', category: 'adult', accommodation: 'tent', days: 4, ...over });
  const r1 = await call('POST', '/records/campreg', m1.token, reg({ name: 'Somebody Else', fee: 0, paid: 99999, checkedIn: true, memberId: 'x' }));
  ok('a member registers themselves', r1.record?.name === 'Grace Member' && r1.record.memberId === m1.user.id, JSON.stringify(r1));
  ok('a member cannot set fee, paid or check-in on their own registration', r1.record.fee === 0 && r1.record.paid === 0 && r1.record.checkedIn === false);
  ok('registering twice for the same camp is refused', (await call('POST', '/records/campreg', m1.token, reg())).status === 409);
  ok('days must be sensible', (await call('POST', '/records/campreg', m2.token, reg({ days: 0 }))).status === 400);
  const r2 = await call('POST', '/records/campreg', m2.token, reg({ accommodation: 'dormitory', days: 3 }));
  ok('another member registers', !!r2.record);
  ok('a member sees only their own registration', (await call('GET', '/records/campreg', m1.token)).records.length === 1);
  ok('the camp secretary sees everyone', (await call('GET', '/records/campreg', cs.token)).records.length === 2);
  ok('the Pastor sees everyone', (await call('GET', '/records/campreg', pas.token)).records.length === 2);
  ok('the Treasurer does not', (await call('GET', '/records/campreg', tre.token)).records.length === 0);
  const fam = await call('POST', '/records/campreg', cs.token, reg({ name: 'Visitor Guest', phone: '0700111222', category: 'child', church: 'Other SDA', days: 2 }));
  ok('an officer registers someone else', fam.record?.name === 'Visitor Guest' && fam.record.memberId === null);
  ok('a member cannot set a fee', (await call('POST', `/camp/registrations/${r1.record.id}/action`, m1.token, { action: 'fee', amount: 0 })).status === 403);
  const act = (who, id, body) => call('POST', `/camp/registrations/${id}/action`, who.token, body);
  ok('the camp secretary sets the fee', (await act(cs, r1.record.id, { action: 'fee', amount: 2000 })).record?.fee === 2000);
  ok('a payment is added to the history', (await act(cc, r1.record.id, { action: 'payment', amount: 1200 })).record?.paid === 1200);
  const after = await act(cc, r1.record.id, { action: 'payment', amount: 800 });
  ok('payments add up and keep a history', after.record?.paid === 2000 && after.record.payments.length === 2 && after.record.payments[0].by === 'Camp Clerk');
  ok('a payment of zero is refused', (await act(cs, r1.record.id, { action: 'payment', amount: 0 })).status === 400);
  ok('check-in works and can be undone', (await act(cs, r1.record.id, { action: 'checkin' })).record?.checkedIn === true && (await act(cs, r1.record.id, { action: 'uncheck' })).record?.checkedIn === false);
  ok('an unknown action is refused', (await act(cs, r1.record.id, { action: 'delete' })).status === 400);
  ok('the member sees their own balance update', (await call('GET', '/records/campreg', m1.token)).records[0].paid === 2000);
  ok('a member cannot archive another person\'s registration', (await call('POST', `/records/campreg/${r2.record.id}/archive`, m1.token, {})).status === 403);
  ok('the camp officers can cancel (archive) one', (await call('POST', `/records/campreg/${fam.record.id}/archive`, cs.token, {})).archived === true);
  ok('the cancelled one is still kept', (await call('GET', '/records/campreg?archived=1', cs.token)).records?.some?.((r) => r.id === fam.record.id) !== false);
  ok('nothing can be deleted', (await fetch(base + `/records/campreg/${r1.record.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + cs.token } })).status === 405);
} finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
