// Treasurer, Secretary and Clerk time-saving tools. Run: node --no-warnings test-clerk-tools.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECRET = 'a1'.repeat(32);
const cleanEnv = { ...process.env }; for (const k of Object.keys(cleanEnv)) if (/^(MPESA|DEFAULT_CHURCH|BOOTSTRAP|DEVELOPERS|DB_FILE|DATA_DIR)/.test(k)) delete cleanEnv[k];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirs = [];
function start(port, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-ct-')); dirs.push(dir);
  const p = spawn('node', ['--no-warnings', new URL('./server.mjs', import.meta.url).pathname], { env: { ...cleanEnv, PORT: port, DATA_DIR: dir, DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 't', BOOTSTRAP: '0711000001:secretary,0711000002:pastor', REMINDERS: 'off', ...extra }, stdio: 'ignore' });
  return { p, base: `http://localhost:${port}` };
}
const mk = (S) => {
  const call = async (method, p, token, body) => { const r = await fetch(S.base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const login = async (phone, profile) => { const o = await call('POST', '/auth/request-otp', null, { phone }); const v = await call('POST', '/auth/verify', null, { phone, code: o.devCode, profile }); return { token: v.token, user: v.user }; };
  return { call, login, hook: (payload) => call('POST', `/hooks/c2b/${SECRET}/confirmation`, null, payload) };
};
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const prof = (name, extra = {}) => ({ name, idNumber: '5' + Math.floor(Math.random() * 1e7), church: 'Test SDA Church', ...extra });
const kd = new Date(Date.now() + 3 * 3600e3); const today = kd.toISOString().slice(0, 10); const yday = new Date(kd - 86400e3).toISOString().slice(0, 10); const tmrw = new Date(+kd + 86400e3).toISOString().slice(0, 10);
const tx = (id, amount) => ({ TransactionType: 'Pay Bill', TransID: id, TransTime: today.replace(/-/g, '') + '093015', TransAmount: amount + '.00', BusinessShortCode: '600966', BillRefNumber: 'x', InvoiceNumber: '', OrgAccountBalance: '1', ThirdPartyTransID: '', MSISDN: '2547 ***** 126', FirstName: 'GRACE', MiddleName: '', LastName: 'WANJIKU' });
const split = [{ category: 'Tithe', percent: 100 }];

const A = start(18200, { MPESA_CALLBACK_SECRET: SECRET, MPESA_SHORTCODE: '600966' }), B = start(18201);
await sleep(1500);
try {
  const a = mk(A);
  const sec = await a.login('0711000001', prof('Ruth Secretary')); const pas = await a.login('0711000002', prof('Pastor John'));
  const role = async (phone, name, r) => { const u = await a.login(phone, prof(name, { role: r })); await a.call('POST', `/users/${u.user.id}/role-decision`, sec.token, { approve: true }); return u; };
  const tre = await role('0733000001', 'Daniel Treasurer', 'treasurer'), clk = await role('0733000002', 'Clara Clerk', 'clerk'), eld = await role('0733000003', 'Elder One', 'elder1');
  const mem = await a.login('0722000001', prof('Grace Member')), mem2 = await a.login('0722000002', prof('Peter Member'));
  const pay = async (u, code, amount) => (await a.call('POST', '/records/payments', u.token, { mpesaCode: code, mpesaName: 'GRACE', purpose: 'Giving', amount, allocations: split })).record;

  // =============================================================== TREASURER: confirm all verified
  const p1 = await pay(mem, 'VER1111111', 1000), p2 = await pay(mem, 'MIS2222222', 500), p3 = await pay(mem2, 'WAI3333333', 300), p4 = await pay(mem2, 'VER4444444', 700), p5 = await pay(mem, 'VER5555555', 200);
  await a.hook(tx('VER1111111', 1000)); await a.hook(tx('MIS2222222', 999)); await a.hook(tx('VER4444444', 700)); await a.hook(tx('VER5555555', 200)); await a.hook(tx('ZZZ9999999', 3000)); // the last one nobody has reported
  ok('a member cannot confirm in bulk', (await a.call('POST', '/payments/receive-verified', mem.token, {})).status === 403);
  ok('the Pastor cannot confirm in bulk', (await a.call('POST', '/payments/receive-verified', pas.token, {})).status === 403);
  const only = await a.call('POST', '/payments/receive-verified', tre.token, { ids: [p4.id] });
  ok('only the chosen payment is confirmed when ids are given', only.received === 1 && only.total === 700 && only.left === 2, JSON.stringify(only));
  const all = await a.call('POST', '/payments/receive-verified', tre.token, {});
  ok('all remaining verified payments are confirmed together', all.received === 2 && all.total === 1200 && all.left === 0 && all.failed === 0, JSON.stringify(all));
  const recs = (await a.call('GET', '/records/receipts', mem.token)).records;
  ok('the member gets a receipt for each', recs.length === 2 && recs.every((r) => /^RCT-/.test(r.receiptNo)), JSON.stringify(recs.map((r) => r.receiptNo)));
  const left = (await a.call('GET', '/records/payments', tre.token)).records.filter((p) => p.status === 'pending').map((p) => p.mpesaCode).sort();
  ok('a mismatch and an unseen payment are left for the Treasurer to check', JSON.stringify(left) === JSON.stringify(['MIS2222222', 'WAI3333333']), JSON.stringify(left));
  ok('running it again does nothing', (await a.call('POST', '/payments/receive-verified', tre.token, {})).received === 0);
  const b = mk(B); const bsec = await b.login('0711000001', prof('Ruth')); const btre = await b.login('0733000001', prof('Dan', { role: 'treasurer' })); await b.call('POST', `/users/${btre.user.id}/role-decision`, bsec.token, { approve: true });
  const off = await b.call('POST', '/payments/receive-verified', btre.token, {});
  ok('without M-Pesa checking, bulk confirm is refused with a clear reason', off.status === 409 && /not switched on/.test(off.error), JSON.stringify(off));

  // =============================================================== TREASURER: reconciliation
  const rq = (u, f = yday, t = tmrw) => a.call('GET', `/finance/reconciliation?from=${f}&to=${t}`, u.token);
  ok('a member cannot see reconciliation', (await rq(mem)).status === 403);
  ok('the Secretary cannot see reconciliation', (await rq(sec)).status === 403);
  const rc = await rq(tre);
  ok('receipted total and count', rc.receipted.total === 1900 && rc.receipted.count === 3, JSON.stringify(rc.receipted));
  ok('receipted by purpose', rc.receipted.byCategory.Tithe === 1900);
  ok('waiting payments (counts and total)', rc.waiting.count === 2 && rc.waiting.total === 800 && rc.waiting.mismatched === 1 && rc.waiting.verified === 0, JSON.stringify(rc.waiting));
  ok('M-Pesa Pay Bill total, with exactly one unclaimed payment', rc.mpesa && rc.mpesa.total === 5899 && rc.mpesa.count === 5 && rc.mpesa.unclaimedCount === 1 && rc.mpesa.unclaimedTotal === 3000, JSON.stringify(rc.mpesa));
  ok('the difference is the Pay Bill total minus receipted', rc.difference === rc.mpesa.total - rc.receipted.total, JSON.stringify([rc.difference, rc.mpesa, rc.receipted]));
  ok('a row per day, and the spreadsheet has a total line', rc.days.some((d) => d.date === today && d.receipted === 1900) && /M-Pesa Pay Bill/.test(rc.csv) && /TOTAL/.test(rc.csv));
  ok('the Pastor can read it', (await rq(pas)).status === 200);
  ok('an earlier range is empty', (await rq(tre, '2020-01-01', '2020-01-31')).receipted.total === 0);
  ok('a bad range is refused', (await rq(tre, tmrw, yday)).status === 400 && (await rq(tre, '2020-01-01', today)).status === 400 && (await rq(tre, 'x', 'y')).status === 400);
  const rb = await b.call('GET', `/finance/reconciliation?from=${yday}&to=${tmrw}`, btre.token);
  ok('without M-Pesa checking the report still works and omits the Pay Bill column', rb.status === 200 && rb.mpesa === null && rb.difference === null && !/M-Pesa Pay Bill/.test(rb.csv));

  // =============================================================== TREASURER: all statements
  const Y = today.slice(0, 4);
  const st = await a.call('GET', `/statements/${Y}/all`, tre.token);
  ok('every giving member is in one spreadsheet', st.members === 2 && st.total === 1900 && /Grace Member/.test(st.csv) && /Peter Member/.test(st.csv) && /0722000001/.test(st.csv), JSON.stringify(st).slice(0, 200));
  ok('a member cannot download everyone\'s statements', (await a.call('GET', `/statements/${Y}/all`, mem.token)).status === 403);
  ok('a nonsense year is refused', (await a.call('GET', '/statements/abcd/all', tre.token)).status === 400);
  ok('a single statement still works', (await a.call('GET', `/statements/${Y}`, mem.token)).status === 200);

  // =============================================================== SECRETARY AND CLERK: the roll
  const bap = async (name, date) => (await a.call('POST', '/records/memberships', sec.token, { fullName: name, entry: 'baptism', baptismDate: date, phone: '0700' + Math.floor(100000 + Math.random() * 899999) })).record;
  const m1 = await bap('Mercy Wambui', `${Y}-03-14`), m2 = await bap('Samuel Otieno', '2019-05-02'), m3 = await bap('John Kamau', '2015-08-09');
  const app = (await a.call('POST', '/membership/apply', mem2.token, { fromChurch: 'Nyeri Town SDA' })).record;
  const set = (u, id, body) => a.call('POST', `/memberships/${id}/status`, u.token, body);
  ok('a member cannot change the roll', (await set(mem, m1.id, { status: 'inactive' })).status === 403);
  ok('the Treasurer cannot change the roll', (await set(tre, m1.id, { status: 'inactive' })).status === 403);
  ok('the Pastor cannot change the roll (the Secretary and Clerk keep it)', (await set(pas, m1.id, { status: 'inactive' })).status === 403);
  ok('an application is decided by the Church Board, not here', (await set(clk, app.id, { status: 'deceased' })).status === 409);
  ok('a bad status is refused', (await set(clk, m1.id, { status: 'banana' })).status === 400);
  ok('moving out needs a destination', (await set(clk, m1.id, { status: 'transferred_out' })).status === 400);
  const out1 = await set(clk, m1.id, { status: 'transferred_out', destination: 'Kisumu Central SDA', note: 'Job transfer' });
  ok('the Clerk records a transfer out, with history', out1.record?.status === 'transferred_out' && out1.record.statusDestination === 'Kisumu Central SDA' && out1.record.statusHistory.length === 1, JSON.stringify(out1));
  ok('the same status twice is refused', (await set(clk, m1.id, { status: 'transferred_out', destination: 'x' })).status === 409);
  const dead = await set(sec, m2.id, { status: 'deceased', date: `${Y}-06-01` });
  ok('the Secretary records a death', dead.record?.status === 'deceased' && dead.record.statusDate === `${Y}-06-01`);
  const back = await set(sec, m1.id, { status: 'active', note: 'Returned' });
  ok('a member can be put back on the roll, and the history keeps every step', back.record?.status === 'active' && back.record.statusHistory.length === 2 && back.record.statusHistory[0].to === 'transferred_out', JSON.stringify(back.record?.statusHistory));
  await set(clk, m1.id, { status: 'transferred_out', destination: 'Kisumu Central SDA' });
  ok('nothing is deleted: records stay in the list', (await a.call('GET', '/records/memberships', sec.token)).records.filter((r) => r.entry === 'baptism').length === 3);

  const roll = await a.call('GET', '/membership/roll', clk.token);
  ok('roll statistics: on the roll and by status', roll.stats.onRoll === 1 && roll.stats.byStatus.deceased === 1 && roll.stats.byStatus.transferred_out === 1, JSON.stringify(roll.stats));
  ok('baptisms by year', roll.stats.baptismsByYear[Y] === 1 && roll.stats.baptismsByYear['2019'] === 1 && roll.stats.baptismsByYear['2015'] === 1, JSON.stringify(roll.stats.baptismsByYear));
  ok('transfers out and deaths by year', roll.stats.transfersOutByYear[Y] === 1 && roll.stats.deathsByYear[Y] === 1);
  ok('the roll spreadsheet lists everyone with status and where they moved', /Member no,Name/.test(roll.csv) && /Mercy Wambui/.test(roll.csv) && /Kisumu Central SDA/.test(roll.csv) && /deceased/.test(roll.csv));
  ok('applications are not on the roll', !/Peter Member/.test(roll.csv));
  ok('the Pastor and an Elder can read the roll', (await a.call('GET', '/membership/roll', pas.token)).status === 200 && (await a.call('GET', '/membership/roll', eld.token)).status === 200);
  ok('a member and the Treasurer cannot', (await a.call('GET', '/membership/roll', mem.token)).status === 403 && (await a.call('GET', '/membership/roll', tre.token)).status === 403);

  // =============================================================== letters and certificates
  const L = (u, id, qs) => a.call('GET', `/membership/${id}/letter?${qs}`, u.token);
  ok('a member cannot issue letters', (await L(mem, m3.id, 'type=baptism')).status === 403);
  ok('an Elder cannot issue letters', (await L(eld, m3.id, 'type=baptism')).status === 403);
  const cert = await L(clk, m3.id, 'type=baptism');
  ok('baptism certificate has the name, date, church and a reference', /BAPTISM CERTIFICATE/.test(cert.text) && /John Kamau/.test(cert.text) && /2015-08-09/.test(cert.text) && /Test SDA Church/.test(cert.text) && new RegExp(`^LTR-${Y}-0001$`).test(cert.ref), JSON.stringify(cert));
  ok('it shows the membership number', /M-\d{4}/.test(cert.text));
  const cert2 = await L(sec, m3.id, 'type=baptism&lang=sw');
  ok('the next letter gets the next reference, and Kiswahili works', cert2.ref === `LTR-${Y}-0002` && /CHETI CHA UBATIZO/.test(cert2.text) && /Mchungaji/.test(cert2.text));
  ok('a letter of membership for someone on the roll', /LETTER OF MEMBERSHIP/.test((await L(clk, m3.id, 'type=membership')).text));
  ok('no letter of membership for someone who has moved away', (await L(clk, m1.id, 'type=membership')).status === 409);
  ok('a transfer letter needs a destination', (await L(clk, m3.id, 'type=transfer')).status === 400);
  const tl = await L(clk, m3.id, 'type=transfer&destination=' + encodeURIComponent('Eldoret Town SDA'));
  ok('a transfer letter names where they are going', /LETTER OF TRANSFER/.test(tl.text) && /Eldoret Town SDA/.test(tl.text) && /John Kamau/.test(tl.text));
  ok('for a member already marked as moved, the destination is remembered', /Kisumu Central SDA/.test((await L(clk, m1.id, 'type=transfer')).text));
  ok('no baptism certificate for someone received by transfer', (await L(clk, app.id, 'type=baptism')).status === 409);
  ok('no letters for an application', (await L(clk, app.id, 'type=membership')).status === 409);
  ok('an unknown letter type is refused', (await L(clk, m3.id, 'type=gift')).status === 400);
  const audit = await a.call('GET', '/audit', sec.token); const entries = audit.audit || audit.entries || [];
  ok('every letter issued is in the audit trail', entries.filter((e) => e.action === 'letter').length >= 5, JSON.stringify(entries.slice(0, 2)));
  ok('status changes are in the audit trail', entries.some((e) => /roll:/.test(e.detail || '')));
  ok('nothing here can be deleted', (await fetch(A.base + `/memberships/${m1.id}/status`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + sec.token } })).status === 405);

  // =============================================================== offline outbox: a retried write is never added twice
  const idem = async (u, key, body) => { const r = await fetch(A.base + '/records/minutes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + u.token, ...(key ? { 'X-Idempotency-Key': key } : {}) }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
  const mn = (t) => ({ kind: 'Church Board', title: t, meetingDate: today, body: 'x' });
  const k1 = 'offline-key-0000000001';
  const i1 = await idem(sec, k1, mn('Written offline')), i2 = await idem(sec, k1, mn('Written offline'));
  ok('the first send adds the record', i1.status === 200 && !i1.replayed && i1.record.title === 'Written offline');
  ok('a retry with the same key returns the same record, marked as replayed', i2.status === 200 && i2.replayed === true && i2.record.id === i1.record.id);
  ok('only one record exists', (await a.call('GET', '/records/minutes', sec.token)).records.filter((r) => r.title === 'Written offline').length === 1);
  const i3 = await idem(sec, 'offline-key-0000000002', mn('Second'));
  ok('a different key adds a different record', i3.record.id !== i1.record.id);
  ok('a key too short to be real is ignored (each send adds a record)', (await idem(sec, 'short', mn('Plain 1'))).record.id !== (await idem(sec, 'short', mn('Plain 1'))).record.id);
  const other = await idem(pas, k1, mn('Pastor note'));
  ok('the same key from another person is a separate write', other.status === 403 || (other.record && other.record.id !== i1.record.id));
  ok('a refused write is not remembered: it can succeed later', (await idem(mem, 'offline-key-0000000003', mn('Nope'))).status === 403);
  ok('the sync history cannot be deleted', await (async () => { const { DatabaseSync } = await import('node:sqlite'); const files = []; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, f.name); if (f.isDirectory()) walk(q); else if (f.name.endsWith('.db') && f.name !== 'platform.db') files.push(q); } }; walk(dirs[0]); for (const f of files) { const d = new DatabaseSync(f); try { d.prepare('DELETE FROM idempotency').run(); d.close(); return false; } catch (e) { d.close(); if (/Archive only/.test(e.message)) return true; } } return false; })());
} finally { A.p.kill(); B.p.kill(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
