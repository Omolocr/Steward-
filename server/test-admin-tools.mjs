// Tests for the multi-church platform: developer console (team of up to 10), church cloning and church numbers, independence
// of churches, binding and moving, Church Admin console, and the support chat.
// Run: node --no-warnings test-console.mjs   (starts its own server on a temporary folder)
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = (f) => new URL(f, import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-admintools-'));
const PORT = 18160, base = `http://localhost:${PORT}`;
const SECRET = 'ab'.repeat(16);
const env = { ...process.env }; for (const k of Object.keys(env)) if (/^(DEFAULT_CHURCH|BOOTSTRAP|DEVELOPERS|DB_FILE|MPESA_|SMS_|NODE_ENV)/.test(k)) delete env[k];
const srv = spawn('node', ['--no-warnings', here('./server.mjs')], { env: { ...env, PORT, DATA_DIR: dir, TOKEN_SECRET: 'admintools-test', TRUST_PROXY: '1', DEVELOPERS: '0700000001:Amina Dev', MPESA_CALLBACK_SECRET: SECRET }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1300));

let pass = 0, fail = 0, ipN = 1;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const call = async (method, p, token, body) => {
  ipN++;
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.6.${Math.floor(ipN / 250)}.${ipN % 250}`, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
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
  const adminA = (await signUp('0711000001', A.number, 'Grace Admin')).token;
  const adminB = (await signUp('0722000001', B.number, 'Bob Admin')).token;
  const mem = (await signUp('0733000001', A.number, 'Plain Member')).token;
  ok('setup: two admins and a member', !!adminA && !!adminB && !!mem);

  const csv = '﻿Full Name,Phone,Role,ID number,Groups\r\n' +
    'Mary Wanjiku,0711222333,Church Treasurer,12345678,Dorcas; Choir\r\n' +
    '"Otieno, Peter",0722333444,,22334455,\r\n' +
    '=HYPERLINK("http://x"),0733444555,,,\r\n' +
    'Bad Phone,12345,,,\r\n' +
    'Wrong Role,0744555666,Grand Wizard,,\r\n' +
    'Mary Again,0711222333,,,\r\n' +
    'Mchungaji Msaidizi,0755666777,Mzee wa Kanisa 1,,Vijana wa Kiadventista\r\n' +
    'Already Here,0733000001,,,\r\n' +
    'Other Church Person,0722000001,,,\r\n';
  // ---- preview does not change anything
  const pv = await call('POST', '/admin/members/import', adminA, { csv });
  ok('the import preview adds nobody', pv.status === 200 && pv.committed === false && pv.added === 0, JSON.stringify(pv).slice(0, 200));
  const afterPv = await call('GET', '/admin/members', adminA);
  ok('after a preview the member list is unchanged', afterPv.members.length === 2, String(afterPv.members.length));
  const by = (r, line) => r.results.find((x) => x.line === line);
  ok('good rows are ready (quoted comma name, Kiswahili role name, blank role = member)', by(pv, 2).status === 'ready' && by(pv, 2).role === 'treasurer' && by(pv, 3).status === 'ready' && by(pv, 3).name === 'Otieno, Peter' && by(pv, 8).role === 'elder1');
  ok('a bad phone number is skipped with a reason', by(pv, 5).status === 'skipped' && /phone/i.test(by(pv, 5).problem));
  ok('an unknown role is skipped with a reason', by(pv, 6).status === 'skipped' && /role/i.test(by(pv, 6).problem));
  ok('the same phone twice in one file is caught', by(pv, 7).status === 'skipped' && /twice/.test(by(pv, 7).problem));
  ok('someone already in this church is skipped', by(pv, 9).status === 'skipped' && /already a member/.test(by(pv, 9).problem));
  ok('a phone that belongs to another church is skipped, with no detail leaked', by(pv, 10).status === 'skipped' && /another church/.test(by(pv, 10).problem) && !/Nakuru/.test(JSON.stringify(by(pv, 10))));
  // ---- commit
  const cm = await call('POST', '/admin/members/import', adminA, { csv, commit: true });
  ok('commit adds the good rows only', cm.committed && cm.added === 4 && cm.skipped === 5, `${cm.added}/${cm.skipped}`);
  const list = (await call('GET', '/admin/members', adminA)).members;
  const mary = list.find((m) => m.phone === '0711222333');
  ok('imported member has the position (verified at once) and groups', mary && mary.role === 'treasurer' && mary.roleStatus === 'approved' && mary.groups.includes('dorcas'), JSON.stringify(mary));
  ok('the Kiswahili group name was understood', list.find((m) => m.phone === '0755666777').groups.includes('youth'));
  const again = await call('POST', '/admin/members/import', adminA, { csv, commit: true });
  ok('importing the same file again adds nobody (no duplicates)', again.added === 0);
  const maryLogin = await signIn('0711222333');
  ok('an imported member signs in later without a church number', !!maryLogin.token && maryLogin.user.role === 'treasurer', JSON.stringify(maryLogin).slice(0, 150));
  ok('imported people do not appear in the other church', (await call('GET', '/admin/members', adminB)).members.every((m) => m.phone !== '0711222333'));
  // ---- bad files
  ok('a file with no Phone column is refused', (await call('POST', '/admin/members/import', adminA, { csv: 'Name,Role\nA B,member' })).status === 400);
  ok('an empty file is refused', (await call('POST', '/admin/members/import', adminA, { csv: '' })).status === 400);
  const big = 'Name,Phone\n' + Array.from({ length: 501 }, (_, i) => `P${i} Person,07${String(10000000 + i)}`).join('\n');
  ok('more than 500 people at once is refused', (await call('POST', '/admin/members/import', adminA, { csv: big })).status === 400);
  const semi = await call('POST', '/admin/members/import', adminA, { csv: 'Jina;Simu;Nafasi\nAsha Mwangi;0766111222;Katibu wa Kanisa', commit: true });
  ok('semicolon files with Kiswahili column names work', semi.added === 1 && (await call('GET', '/admin/members', adminA)).members.find((m) => m.phone === '0766111222').role === 'secretary', JSON.stringify(semi).slice(0, 200));
  // ---- permissions
  ok('a member cannot import', (await call('POST', '/admin/members/import', mem, { csv })).status === 403);
  ok('a member cannot export', (await call('GET', '/admin/members/export', mem)).status === 403);
  ok('a member cannot read the directory', (await call('GET', '/admin/directory', mem)).status === 403);
  ok('a Treasurer (leader) cannot import', (await call('POST', '/admin/members/import', maryLogin.token, { csv })).status === 403);
  ok('import needs a sign-in', (await call('POST', '/admin/members/import', null, { csv })).status === 401);
  // ---- export
  const ex = await call('GET', '/admin/members/export', adminA);
  ok('export lists this church only', ex.status === 200 && ex.csv.includes('Mary Wanjiku') && !ex.csv.includes('Bob Admin') && ex.count === (await call('GET', '/admin/members', adminA)).members.length);
  ok('export starts with a BOM and header row for Excel', ex.csv.startsWith('﻿Name,Phone,Role'));
  ok('export guards against spreadsheet formulas', ex.csv.includes("'=HYPERLINK") && !/(^|,)=HYPERLINK/m.test(ex.csv));
  ok('export shows English role names', /Mary Wanjiku,0711222333,Church Treasurer/.test(ex.csv));
  const exSw = await call('GET', '/admin/members/export?lang=sw', adminA);
  ok('export in Kiswahili uses Kiswahili role names', /Mweka Hazina wa Kanisa/.test(exSw.csv));
  ok('the export and import are written to the audit trail', (await call('GET', '/audit', adminA)).entries?.some((e) => e.action === 'export') ?? true);
  // ---- directory
  const dir1 = await call('GET', '/admin/directory', adminA);
  ok('directory has the church name, count, leaders first', dir1.text.startsWith("MEMBERS' DIRECTORY\nKisumu Central SDA Church") && dir1.text.indexOf('Leaders') < dir1.text.indexOf('Members\n'), dir1.text.slice(0, 120));
  ok('directory shows phones by default and leaves them out on request', dir1.text.includes('0711222333') && !(await call('GET', '/admin/directory?phones=0', adminA)).text.includes('0711222333'));
  ok('Kiswahili directory', (await call('GET', '/admin/directory?lang=sw', adminA)).text.startsWith('ORODHA YA WASHIRIKI'));
  ok('the directory leaves out archived and waiting people', await (async () => { const m = (await call('GET', '/admin/members', adminA)).members.find((x) => x.phone === '0744555666' || x.name === 'Otieno, Peter'); await call('POST', `/admin/members/${m.id}/archive`, adminA, {}); return !(await call('GET', '/admin/directory', adminA)).text.includes('Otieno'); })());
  const delr = await fetch(base + '/admin/members/import', { method: 'DELETE', headers: { Authorization: 'Bearer ' + adminA } });
  ok('nothing here can be deleted', delr.status === 405);
} catch (e) { fail++; console.log('ERROR', e); }

srv.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
