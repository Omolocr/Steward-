// Reminders: gentle nudges when something has waited too long. Run: node --no-warnings test-reminders.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-rm-'));
const PORT = 18180, PUSHPORT = 18181;
const pushes = [];
const fake = http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
    const list = JSON.parse(raw); pushes.push(...list);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: list.map(() => ({ status: 'ok', id: 'x' })) }));
  });
}).listen(PUSHPORT);
let out = '';
const srv = spawn('node', ['--no-warnings', new URL('./server.mjs', import.meta.url).pathname], {
  env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'test', BOOTSTRAP: '0711000001:secretary,0711000002:pastor',
    PUSH_PROVIDER: 'expo', EXPO_PUSH_URL: `http://localhost:${PUSHPORT}`, REMINDER_ANYTIME: '1', REMINDER_CHECK_MS: '400', REMINDER_AFTER_HOURS: '48', REMINDER_EVERY_HOURS: '24' },
});
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
await new Promise((r) => setTimeout(r, 1000));
const base = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const wait = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
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
const reg = (u, t) => call('POST', '/me/push-token', u.token, { token: t, platform: 'android' });
const churchDb = () => {
  const found = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.db') && f.name !== 'platform.db') found.push(p); } };
  walk(dir);
  for (const f of found) { const d = new DatabaseSync(f); try { d.prepare('SELECT 1 FROM reminder_log LIMIT 1').get(); return d; } catch { d.close(); } }
  throw new Error('church database not found');
};
const remindersTo = (t) => pushes.filter((m) => m.to === t && m.data?.kind && /^remind_/.test(m.data.kind));

try {
  const sec = await login('0711000001', prof('Ruth Njeri'));
  const pas = await login('0711000002', prof('Pastor John'));
  const tre = await login('0733000002', prof('Daniel Treasurer', { role: 'treasurer' }), 'sw');
  const mem = await login('0722000001', prof('Grace Member'));
  await call('GET', '/me', tre.token, null, 'sw');
  await call('POST', `/users/${tre.user.id}/role-decision`, sec.token, { approve: true });
  const lea = await login('0733000009', prof('Peter Wannabe', { role: 'elder1' })); // asks for a leader position: pending
  for (const [u, t] of [[sec, 'SEC'], [pas, 'PAS'], [tre, 'TRE'], [mem, 'MEM']]) await reg(u, tok(t));

  await wait();
  ok('nothing is sent when nothing has waited long', remindersTo(tok('TRE')).length === 0 && remindersTo(tok('SEC')).length === 0, JSON.stringify(pushes.map((m) => m.title)));

  // ---- a payment waits: only the Treasurer is nudged, in their language, with a count and no names or amounts
  const pay = await call('POST', '/records/payments', mem.token, { mpesaCode: 'QWE1234567', mpesaName: 'GRACE M', purpose: 'Monthly tithe', amount: 1234, allocations: [{ category: 'Tithe', percent: 100 }] });
  ok('payment sent', pay.status === 200 || pay.status === 201, JSON.stringify(pay));
  await wait();
  ok('a fresh payment gets no nudge', remindersTo(tok('TRE')).length === 0);
  const db = churchDb();
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  db.prepare("UPDATE records SET created_at=? WHERE col='payments'").run(ago(60));
  await wait();
  const r1 = remindersTo(tok('TRE'));
  ok('Treasurer is nudged once the payment has waited over 2 days', r1.length === 1 && r1[0].data.kind === 'remind_payments', JSON.stringify(r1));
  ok('the nudge is in Kiswahili for a Kiswahili user', /Malipo yanasubiri/.test(r1[0]?.title || ''), r1[0]?.title);
  ok('the nudge carries only a count (no names, codes or amounts)', !/Grace|QWE1234567|1234|1,234/.test(JSON.stringify(r1[0])), JSON.stringify(r1[0]));
  ok('nobody else is nudged about payments', remindersTo(tok('MEM')).length === 0 && !remindersTo(tok('SEC')).some((m) => m.data.kind === 'remind_payments') && !remindersTo(tok('PAS')).some((m) => m.data.kind === 'remind_payments'));
  await wait();
  ok('not repeated within 24 hours', remindersTo(tok('TRE')).length === 1);
  const log1 = db.prepare("SELECT * FROM reminder_log WHERE kind='payments'").get();
  ok('the nudge is written to the reminder log', log1 && log1.count === 1);

  // ---- the next day it is repeated while the payment is still waiting
  db.prepare("UPDATE reminder_log SET last_at=? WHERE kind='payments'").run(ago(25));
  await wait();
  ok('repeated the next day while still waiting', remindersTo(tok('TRE')).length === 2);

  // ---- once the Treasurer confirms it, the nudges stop
  const rec = await call('POST', `/payments/${pay.record.id}/receive`, tre.token, {});
  ok('payment received', rec.status === 200, JSON.stringify(rec));
  db.prepare("UPDATE reminder_log SET last_at=? WHERE kind='payments'").run(ago(30));
  await wait();
  ok('no more nudges after it is confirmed', remindersTo(tok('TRE')).length === 2);

  // ---- a leader position waits: Secretary and Pastor are nudged
  db.prepare("UPDATE users SET created_at=? WHERE phone='0733000009'").run(ago(60));
  await wait();
  ok('Secretary is nudged about the waiting position', remindersTo(tok('SEC')).some((m) => m.data.kind === 'remind_roles'));
  ok('Pastor is nudged about the waiting position', remindersTo(tok('PAS')).some((m) => m.data.kind === 'remind_roles'));
  ok('the Treasurer is not told about positions', !remindersTo(tok('TRE')).some((m) => m.data.kind === 'remind_roles'));
  await call('POST', `/users/${lea.user.id}/role-decision`, sec.token, { approve: true });
  const before = remindersTo(tok('SEC')).filter((m) => m.data.kind === 'remind_roles').length;
  db.prepare("UPDATE reminder_log SET last_at=? WHERE kind='roles'").run(ago(30));
  await wait();
  ok('no more position nudges once decided', remindersTo(tok('SEC')).filter((m) => m.data.kind === 'remind_roles').length === before);

  // ---- a transfer application waits for the Church Board (3 days): the Pastor is nudged
  const ap = await call('POST', '/membership/apply', mem.token, { fromChurch: 'Nyeri Town SDA', letterRef: 'TL/1' });
  ok('transfer application sent', ap.status === 200 || ap.status === 201, JSON.stringify(ap));
  db.prepare("UPDATE records SET created_at=? WHERE col='memberships'").run(ago(60));
  await wait();
  ok('not yet nudged at 60 hours (the Board gets 3 days)', !remindersTo(tok('PAS')).some((m) => m.data.kind === 'remind_transfers'));
  db.prepare("UPDATE records SET created_at=? WHERE col='memberships'").run(ago(80));
  await wait();
  ok('Pastor is nudged after 3 days', remindersTo(tok('PAS')).some((m) => m.data.kind === 'remind_transfers' && /Transfer applications are waiting/.test(m.title)));

  // ---- archive-only
  let blocked = false; try { db.prepare('DELETE FROM reminder_log').run(); } catch { blocked = true; }
  ok('the reminder log cannot be deleted', blocked);
  ok('server log shows no failures', !/Reminders failed/.test(out), out.slice(-300));
  db.close();
} finally {
  srv.kill(); fake.close(); fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
