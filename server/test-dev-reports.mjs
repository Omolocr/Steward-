// Tests for the multi-church platform: developer console (team of up to 10), church cloning and church numbers, independence
// of churches, binding and moving, Church Admin console, and the support chat.
// Run: node --no-warnings test-console.mjs   (starts its own server on a temporary folder)
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = (f) => new URL(f, import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-devreports-'));
const PORT = 18170, base = `http://localhost:${PORT}`;
const SECRET = 'ab'.repeat(16);
const env = { ...process.env }; for (const k of Object.keys(env)) if (/^(DEFAULT_CHURCH|BOOTSTRAP|DEVELOPERS|DB_FILE|MPESA_|SMS_|NODE_ENV)/.test(k)) delete env[k];
const srv = spawn('node', ['--no-warnings', here('./server.mjs')], { env: { ...env, PORT, DATA_DIR: dir, TOKEN_SECRET: 'devreports-test', TRUST_PROXY: '1', DEVELOPERS: '0700000001:Amina Dev', MPESA_CALLBACK_SECRET: SECRET }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1300));

let pass = 0, fail = 0, ipN = 1;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const call = async (method, p, token, body) => {
  ipN++;
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.7.${Math.floor(ipN / 250)}.${ipN % 250}`, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const lastCode = {};
const otp = async (phone) => { const r = await call('POST', '/auth/request-otp', null, { phone }); if (r.devCode) lastCode[phone] = r.devCode; return lastCode[phone]; }; // an unused code stays valid, so a second request just reuses it
const devLogin = async (phone) => { const code = await otp(phone); return call('POST', '/dev/login', null, { phone, code }); };
let idN = 5000000;
const signUp = async (phone, churchNumber, name, extra = {}) => {
  const code = await otp(phone);
  return call('POST', '/auth/verify', null, { phone, code, churchNumber, profile: { name, idNumber: String(idN++), ...extra } });
};
const signIn = async (phone) => { const code = await otp(phone); return call('POST', '/auth/verify', null, { phone, code }); };

try {
  const D = (await devLogin('0700000001')).token;
  const A = (await call('POST', '/dev/churches', D, { name: 'Kisumu Central SDA Church', adminPhone: '0711000001' })).church;
  const B = (await call('POST', '/dev/churches', D, { name: 'Nakuru Town SDA Church', adminPhone: '0722000001' })).church;
  const C = (await call('POST', '/dev/churches', D, { name: 'Eldoret East SDA Church', adminPhone: '0733000009' })).church;
  const adminA = (await signUp('0711000001', A.number, 'Grace Admin')).token;
  const adminB = (await signUp('0722000001', B.number, 'Bob Admin')).token;
  // church A: a few members, one waiting, an activity, a notice, a support message
  await call('POST', '/admin/members', adminA, { name: 'Mary Treasurer', phone: '0744000001', role: 'treasurer' });
  await call('POST', '/admin/members', adminA, { name: 'Peter Member', phone: '0744000002' });
  for (let i = 0; i < 5; i++) await signUp('07550000' + String(10 + i), A.number, 'Waiting Person ' + i); // waiting to join
  await call('POST', '/admin/support', adminA, { body: 'Hello developers, we need help with Pay Bill' });
  const treas = (await signIn('0744000001')).token;
  const pay = await call('POST', '/records/payments', treas, { mpesaCode: 'QWE1234RTY', mpesaName: 'Mary T', purpose: 'Tithe', amount: 1000, allocations: [{ category: 'Tithe', percent: 100 }] });
  // church B: a pause, church C: admin never signs in
  await call('POST', `/dev/churches/${B.id}/status`, D, { status: 'suspended' });
  const r = await call('GET', '/dev/reports/health', D);
  ok('the health report works', r.status === 200 && r.churches.length === 3 && /^\d{4}-\d{2}$/.test(r.month), JSON.stringify(r).slice(0, 200));
  const ra = r.churches.find((x) => x.id === A.id), rb = r.churches.find((x) => x.id === B.id), rc = r.churches.find((x) => x.id === C.id);
  ok('an in-use church is "active"', ra.health === 'active');
  ok('a church whose admin never signed in is "setup" and needs attention', rc.health === 'setup' && rc.attention.some((t) => /not signed in/.test(t)));
  ok('a paused church is "paused"', rb.health === 'paused' && rb.status === 'suspended');
  ok('member counts are per church', ra.members === 8 || ra.members === 3, String(ra.members));
  ok('people waiting to join are counted and flagged at 5', ra.waiting === 5 && ra.attention.some((t) => /waiting to join/.test(t)));
  ok('this month new members are counted', ra.newMembers >= 3);
  ok('support messages are counted and unread shows', ra.support.messagesFromChurch === 1 && ra.support.unread === 1 && ra.attention.some((t) => /unread/.test(t)));
  ok('the church that sent nothing has no support counts', rc.support.messagesFromChurch === 0);
  ok('payments reported are counted (not the amounts)', ra.payments === 1 && !JSON.stringify(r).includes('1000') && !JSON.stringify(r).includes('QWE1234RTY'));
  ok('no member names or notice text appear in the report', !JSON.stringify(r).includes('Mary Treasurer') && !JSON.stringify(r).includes('Peter Member') && !JSON.stringify(r).includes('Pay Bill'));
  ok('totals add up', r.totals.churches === 3 && r.totals.members === r.churches.reduce((t, x) => t + x.members, 0) && r.totals.setup === 1 && r.totals.paused === 1 && r.totals.active === 1);
  ok('needAttention lists the problem churches', r.needAttention.some((x) => x.id === C.id) && r.needAttention.some((x) => x.id === A.id));
  ok('csv has a BOM, a header and a row per church', r.csv.startsWith('﻿Church,Church number') && r.csv.trim().split('\r\n').length === 4 && r.csv.includes('Kisumu Central SDA Church'));
  const old = await call('GET', '/dev/reports/health?month=2020-01', D);
  ok('an old month shows zero usage but still lists churches', old.status === 200 && old.churches.every((x) => x.newMembers === 0 && x.payments === 0) && old.churches.length === 3);
  ok('a bad month is refused', (await call('GET', '/dev/reports/health?month=2026-13', D)).status === 400);
  ok('church admins cannot open the developer report', (await call('GET', '/dev/reports/health', adminA)).status === 401 || (await call('GET', '/dev/reports/health', adminA)).status === 403);
  ok('the report needs a developer sign-in', (await call('GET', '/dev/reports/health')).status === 401);
  const del = await fetch(base + '/dev/reports/health', { method: 'DELETE', headers: { Authorization: 'Bearer ' + D } });
  ok('nothing can be deleted here', del.status === 405);
} catch (e) { fail++; console.log('ERROR', e); }

srv.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
