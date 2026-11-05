// Yearly church report for the Pastor and Church Board. Run: node --no-warnings test-yearly.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-yr-'));
const PORT = 18190;
const srv = spawn('node', ['--no-warnings', new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 't', BOOTSTRAP: '0711000001:secretary,0711000002:pastor', REMINDERS: 'off' }, stdio: 'ignore' });
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
const Y = String(new Date(Date.now() + 3 * 3600e3).getUTCFullYear());
try {
  const sec = await login('0711000001', prof('Secretary')); const pas = await login('0711000002', prof('Pastor'));
  const mk = async (phone, name, role) => { const u = await login(phone, prof(name, role ? { role } : {})); if (role) await call('POST', `/users/${u.user.id}/role-decision`, sec.token, { approve: true }); return u; };
  const tre = await mk('0733000001', 'Treasurer', 'treasurer'), ss = await mk('0733000002', 'SS', 'sabbath_school'), bld = await mk('0733000003', 'Builder', 'building');
  const cs = await mk('0733000004', 'Camp Sec', 'camp_secretary'), el = await mk('0733000005', 'Elder', 'elder2'), dor = await mk('0733000006', 'Dorcas', 'dorcas_leader');
  const m1 = await login('0722000001', prof('Grace Member'));

  // ---- who may read it
  const get = (u, y = Y, lang) => call('GET', `/reports/yearly/${y}${lang ? '?lang=' + lang : ''}`, u.token);
  ok('a member cannot read it', (await get(m1)).status === 403);
  ok('a group leader cannot read it', (await get(dor)).status === 403);
  ok('signing in is required', (await call('GET', `/reports/yearly/${Y}`, null)).status === 401);
  ok('the Pastor can', (await get(pas)).status === 200);
  ok('the Treasurer can', (await get(tre)).status === 200);
  ok('the Secretary can', (await get(sec)).status === 200);
  ok('an Elder (Church Board) can', (await get(el)).status === 200);
  ok('a nonsense year is refused', (await get(pas, 'abcd')).status === 400);

  // ---- an empty year is all zeros, not an error
  const e0 = await get(pas);
  ok('an empty report is all zeros', e0.giving.total === 0 && e0.membership.onRoll === 0 && e0.sabbathSchool.weeks === 0 && e0.camp.registrations === 0, JSON.stringify(e0).slice(0, 300));

  // ---- fill the year
  const pay = async (code, amount, cats) => { const p = await call('POST', '/records/payments', m1.token, { mpesaCode: code, mpesaName: 'GRACE M', purpose: 'Giving', amount, allocations: cats }); return call('POST', `/payments/${p.record.id}/receive`, tre.token, {}); };
  ok('giving 1', (await pay('AAA1111111', 1000, [{ category: 'Tithe', percent: 80 }, { category: 'Offering', percent: 20 }])).status === 200);
  ok('giving 2', (await pay('BBB2222222', 500, [{ category: 'Tithe', percent: 100 }])).status === 200);
  await call('POST', '/records/memberships', sec.token, { fullName: 'Mercy Wambui', entry: 'baptism', baptismDate: `${Y}-03-14`, phone: '0712345678' });
  await call('POST', '/records/memberships', sec.token, { fullName: 'Samuel Otieno', entry: 'baptism', baptismDate: `${Y}-05-02`, phone: '0712345679' });
  await call('POST', '/membership/apply', m1.token, { fromChurch: 'Nyeri Town SDA' });
  const att = (d, a, b, v) => ({ office: 'sabbath_school', kind: 'attendance', date: d, classes: [{ name: 'Adult', enrolled: 60, present: a }, { name: 'Kids', enrolled: 20, present: b }], visitors: v });
  await call('POST', '/records/office', ss.token, att(`${Y}-06-06`, 40, 10, 3));
  await call('POST', '/records/office', ss.token, att(`${Y}-06-13`, 50, 20, 5));
  const pl = await call('POST', '/records/office', bld.token, { office: 'building', kind: 'pledge', pledger: 'Mama Wanjiku', amount: 50000, due: `${Y}-12-31` });
  await call('POST', '/records/office', bld.token, { office: 'building', kind: 'pledge_payment', pledgeId: pl.record.id, amount: 20000, date: `${Y}-07-01` });
  await call('POST', '/records/projects', bld.token, { project: 'Church Building', kind: 'contribution', title: 'Harambee', amount: 120000 });
  await call('POST', '/records/projects', bld.token, { project: 'Church Building', kind: 'expense', title: 'Cement', amount: 45000 });
  await call('POST', '/records/welfare', tre.token, { fund: 'Burial and Benevolent Fund', kind: 'contribution', title: 'Monthly', amount: 3000 });
  const cr = await call('POST', '/records/campreg', m1.token, { camp: 'Camp', category: 'adult', accommodation: 'tent', days: 4 });
  await call('POST', `/camp/registrations/${cr.record.id}/action`, cs.token, { action: 'fee', amount: 2000 });
  await call('POST', `/camp/registrations/${cr.record.id}/action`, cs.token, { action: 'payment', amount: 1500 });

  const r = await get(pas);
  ok('giving total is the sum of receipts', r.giving.total === 1500 && r.giving.receipts === 2, JSON.stringify(r.giving));
  ok('giving split by purpose is right', r.giving.byCategory.Tithe === 1300 && r.giving.byCategory.Offering === 200, JSON.stringify(r.giving.byCategory));
  ok('giving by month adds up to the total', r.giving.byMonth.length === 12 && r.giving.byMonth.reduce((a, b) => a + b, 0) === 1500);
  ok('two baptisms counted', r.membership.baptisms === 2, JSON.stringify(r.membership));
  ok('the waiting transfer is counted', r.membership.transfersWaiting === 1);
  ok('Sabbath School weeks and average', r.sabbathSchool.weeks === 2 && r.sabbathSchool.averagePresent === 60 && r.sabbathSchool.visitors === 8, JSON.stringify(r.sabbathSchool));
  ok('welfare total by fund', r.welfare['Burial and Benevolent Fund'] >= 3000, JSON.stringify(r.welfare));
  ok('building contributions and spending', r.building.contributions >= 120000 && r.building.spent === 45000, JSON.stringify(r.building));
  ok('pledges: pledged, paid and balance', r.building.pledged === 50000 && r.building.pledgePaid === 20000 && r.building.pledgeBalance === 30000, JSON.stringify(r.building));
  ok('camp registrations, fees and payments', r.camp.registrations === 1 && r.camp.fees === 2000 && r.camp.paid === 1500, JSON.stringify(r.camp));
  ok('a different year is separate', (await get(pas, String(Number(Y) - 1))).giving.total === 0);

  // ---- privacy: totals only
  const txt = JSON.stringify(r);
  ok('no member name, M-Pesa code or phone appears in the report', !/Grace|AAA1111111|BBB2222222|0712345678|Mercy|Otieno|Wanjiku/.test(txt), txt.slice(0, 200));

  // ---- text, Kiswahili
  ok('English printable text has the church name and total', r.text.includes('Annual Church Report') && r.text.includes('Test SDA Church') && /1,500/.test(r.text), r.text.slice(0, 200));
  const sw = await get(pas, Y, 'sw');
  ok('Kiswahili text', /Ripoti ya Mwaka ya Kanisa/.test(sw.text) && /Utoaji/.test(sw.text) && !/Annual Church Report/.test(sw.text));
  ok('the figures are the same in Kiswahili', sw.giving.total === r.giving.total);

  // ---- archived things no longer count; and nothing here deletes
  const regs = await call('GET', '/records/campreg', cs.token);
  await call('POST', `/records/campreg/${regs.records[0].id}/archive`, cs.token, {});
  ok('an archived registration stops counting', (await get(pas)).camp.registrations === 0);
  ok('reading the report is written to the audit trail', (await call('GET', '/audit', sec.token)).entries?.some((e) => e.action === 'report') ?? (await call('GET', '/audit', sec.token)).audit?.some((e) => e.action === 'report'));
  ok('the report cannot be changed or deleted', (await call('POST', `/reports/yearly/${Y}`, pas.token, {})).status >= 400 && (await fetch(base + `/reports/yearly/${Y}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + pas.token } })).status === 405);
} finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
