// Kiswahili for server messages + SMS, and push notifications. Run: node --no-warnings test-lang-push.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-lp-'));
const PORT = 18160, PUSHPORT = 18161;
// A stand-in for Expo's push service. Tokens containing "DEAD" are reported as no longer registered.
const pushes = [];
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
    const list = JSON.parse(raw); pushes.push(...list);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: list.map((m) => (m.to.includes('DEAD') ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' })) }));
  });
}).listen(PUSHPORT);
let out = '';
const srv = spawn('node', ['--no-warnings', new URL('./server.mjs', import.meta.url).pathname], {
  env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'test', BOOTSTRAP: '0711000001:secretary,0711000002:pastor', PUSH_PROVIDER: 'expo', EXPO_PUSH_URL: `http://localhost:${PUSHPORT}/push` }, stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
await new Promise((r) => setTimeout(r, 1000));
const base = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const call = async (method, p, token, body, lang) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(lang ? { 'X-Lang': lang } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
async function login(phone, profile, lang) {
  const o = await call('POST', '/auth/request-otp', null, { phone }, lang);
  const v = await call('POST', '/auth/verify', null, { phone, code: o.devCode, profile }, lang);
  return { token: v.token, user: v.user };
}
const prof = (name, extra = {}) => ({ name, idNumber: '3' + Math.floor(Math.random() * 1e7), church: 'Test SDA Church', ...extra });
const tok = (s) => `ExponentPushToken[${s}${'x'.repeat(12)}]`;

try {
  // ---- Kiswahili errors and SMS
  const wrong = await call('POST', '/auth/verify', null, { phone: '0733000001', code: '000000', profile: prof('X') }, 'sw');
  ok('error message in Kiswahili when the app asks for it', wrong.error === 'Nambari si sahihi.' || /Nambari|muda|sahihi/.test(wrong.error || ''), wrong.error);
  const en = await call('POST', '/auth/verify', null, { phone: '0733000001', code: '000000', profile: prof('X') });
  ok('English by default', /code|Code|Wrong/.test(en.error || ''), en.error);
  const noAuth = await call('GET', '/me', null, null, 'sw');
  ok('"Please sign in" in Kiswahili', noAuth.error === 'Tafadhali ingia.', noAuth.error);
  const del = await fetch(base + '/records/notices/x', { method: 'DELETE', headers: { 'X-Lang': 'sw' } }).then((r) => r.json());
  ok('the archive-only refusal is translated too', /Kuhifadhi tu/.test(del.error), del.error);
  ok('unknown language falls back to English', (await call('GET', '/me', null, null, 'fr')).error === 'Please sign in.');

  await call('POST', '/auth/request-otp', null, { phone: '0744000001' }, 'sw');
  ok('login code SMS is in Kiswahili', /Nambari yako ya Church Connect ni \d{6}/.test(out));
  await call('POST', '/auth/request-otp', null, { phone: '0744000002' });
  ok('login code SMS is in English by default', /Your Church Connect code is \d{6}/.test(out));

  // ---- people
  const sec = await login('0711000001', prof('Ruth Njeri'));
  const pas = await login('0711000002', prof('Pastor John'));
  const tre = await login('0733000002', prof('Daniel Treasurer', { role: 'treasurer' }), 'en');
  const mem = await login('0722000001', prof('Grace Member', { groups: ['dorcas'] }), 'sw');
  const dor = await login('0733000003', prof('Mary Dorcas', { role: 'dorcas_leader', groups: ['dorcas'] }));
  await call('GET', '/me', mem.token, null, 'sw'); // the app's first call stores the language
  ok('the person language is remembered', true);

  // role decision: SMS to the applicant in their own language
  await call('GET', '/me', tre.token, null, 'sw');
  out = '';
  const dec = await call('POST', `/users/${tre.user.id}/role-decision`, sec.token, { approve: true });
  await wait();
  ok('role verified', dec.user?.role === 'treasurer');
  ok('role SMS goes out in the applicant\'s language (Kiswahili)', /Nafasi yako ya Mweka Hazina wa Kanisa imethibitishwa/.test(out), out.slice(-200));
  await call('POST', `/users/${dor.user.id}/role-decision`, sec.token, { approve: true });

  // ---- push registration
  const bad = await call('POST', '/me/push-token', mem.token, { token: 'not-a-token' });
  ok('a bad device token is refused', bad.status === 400);
  const noauth = await call('POST', '/me/push-token', null, { token: tok('a') });
  ok('registering needs sign-in', noauth.status === 401);
  const reg = (u, t) => call('POST', '/me/push-token', u.token, { token: t, platform: 'android' });
  ok('member registers a phone', (await reg(mem, tok('MEM'))).registered === true);
  ok('treasurer registers a phone', (await reg(tre, tok('TRE'))).registered === true);
  ok('group leader registers a phone', (await reg(dor, tok('DOR'))).registered === true);
  ok('secretary registers a phone', (await reg(sec, tok('SEC'))).registered === true);
  ok('registering the same phone twice is fine', (await reg(mem, tok('MEM'))).registered === true);

  // ---- payment: treasurer is pushed; receipt: member is pushed in Kiswahili + SMS + receipt text in Kiswahili
  pushes.length = 0; out = '';
  const pay = await call('POST', '/records/payments', mem.token, { mpesaCode: 'QWE1234567', mpesaName: 'GRACE M', purpose: 'Monthly tithe', amount: 1000, allocations: [{ category: 'Tithe', percent: 100 }] }, 'sw');
  ok('payment submitted', !!pay.record, JSON.stringify(pay));
  await wait();
  ok('the treasurer gets a push about the new payment', pushes.some((m) => m.to === tok('TRE') && /New payment|Malipo mapya/.test(m.title)), JSON.stringify(pushes));
  ok('nobody else is pushed about it', pushes.filter((m) => /New payment|Malipo mapya/.test(m.title)).length === 1);
  pushes.length = 0;
  const rec = await call('POST', `/payments/${pay.record.id}/receive`, tre.token, {});
  await wait();
  ok('treasurer receives the payment', rec.status === 200, JSON.stringify(rec));
  const mp = pushes.find((m) => m.to === tok('MEM'));
  ok('member is pushed in Kiswahili', mp && mp.title === 'Risiti yako' && /imepokea/.test(mp.body), JSON.stringify(mp));
  ok('push carries the screen to open', mp && mp.data.screen === 'receipts');
  ok('receipt SMS in Kiswahili', /imepokea KSh 1,000/.test(out) && /Asante, Mungu akubariki/.test(out), out.slice(-300));
  const receipts = await call('GET', '/records/receipts', mem.token, null, 'sw');
  ok('the receipt text itself is in Kiswahili', /RISITI RASMI/.test(receipts.records?.[0]?.text || ''), JSON.stringify(receipts).slice(0, 200));

  // ---- notices
  pushes.length = 0;
  const n = await call('POST', '/records/notices', pas.token, { board: 'church', title: 'Board meeting', body: 'Sunday 2pm' });
  await wait();
  ok('church notice reaches members and leaders', ['MEM', 'TRE', 'SEC', 'DOR'].every((k) => pushes.some((m) => m.to === tok(k))), JSON.stringify(pushes.map((m) => m.to)));
  ok('the author is not pushed about their own post', !pushes.some((m) => m.to === tok('PAS')));
  ok('member got it in Kiswahili title', pushes.find((m) => m.to === tok('MEM')).title === 'Ubao wa Matangazo wa Kanisa' && pushes.find((m) => m.to === tok('PAS')) === undefined);
  pushes.length = 0;
  const g = await call('POST', '/records/notices', mem.token, { board: 'group', groupKey: 'dorcas', title: 'Visit the sick', body: 'Saturday' });
  await wait();
  ok('a member\'s group post waits for approval', g.record?.status === 'pending');
  ok('only the group leader is pushed to approve', pushes.length === 1 && pushes[0].to === tok('DOR') && /approval/.test(pushes[0].title), JSON.stringify(pushes));
  pushes.length = 0;
  await call('POST', `/notices/${g.record.id}/approve`, dor.token, {});
  await wait();
  ok('group post push names the group in the reader\'s language', pushes.some((m) => m.to === tok('MEM') && /^Dorkasi – /.test(m.title)), JSON.stringify(pushes.map((m) => m.title)));
  ok('after approval group members are pushed (not the approver)', pushes.some((m) => m.to === tok('MEM')) && !pushes.some((m) => m.to === tok('DOR')), JSON.stringify(pushes.map((m) => m.to)));

  // ---- off switch and dead tokens
  await call('POST', '/me/push-token/off', mem.token, { token: tok('MEM') });
  pushes.length = 0;
  await call('POST', '/records/notices', pas.token, { board: 'church', title: 'Second', body: 'x' });
  await wait();
  ok('a phone that switched notifications off gets nothing', !pushes.some((m) => m.to === tok('MEM')) && pushes.some((m) => m.to === tok('TRE')));
  await reg(mem, `ExponentPushToken[DEAD${'y'.repeat(12)}]`);
  pushes.length = 0;
  await call('POST', '/records/notices', pas.token, { board: 'church', title: 'Third', body: 'x' });
  await wait(600);
  ok('a dead phone is tried once', pushes.filter((m) => m.to.includes('DEAD')).length === 1);
  pushes.length = 0;
  await call('POST', '/records/notices', pas.token, { board: 'church', title: 'Fourth', body: 'x' });
  await wait(600);
  ok('...and then switched off automatically', pushes.filter((m) => m.to.includes('DEAD')).length === 0);

  // ---- pending people are not pushed
  const reg2 = await call('POST', '/me/lang', mem.token, { lang: 'xx' });
  ok('a bad language is refused', reg2.status === 400);
  ok('language can be set explicitly', (await call('POST', '/me/lang', mem.token, { lang: 'en' })).lang === 'en');

  // ---- nothing deletable
  const t = await call('POST', '/me/push-token/off', mem.token, { token: tok('MEM') });
  ok('switching off keeps the row (archive-only)', t.registered === false);
} finally {
  srv.kill(); fake.close(); fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
