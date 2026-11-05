// Checks that the app's permission rules (src/services/permissions.ts: which buttons are shown) agree with the server's
// rules (what is actually allowed). It compiles the app's real permissions file, then asks the live server the same
// question for every role. A disagreement means a button that gets refused, or a missing button.
// Run: node --no-warnings test-parity.mjs      (needs the TypeScript compiler: tsc)
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const here = (f) => new URL(f, import.meta.url).pathname;
const src = here('../src');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'church-parity-'));
// The project pins TypeScript 5.x (package.json); a newer global tsc (6+) also needs --ignoreConfig / --ignoreDeprecations to ignore the
// project's tsconfig.json. Pass those only when the compiler knows them, so the test runs with either.
const tscBin = fs.existsSync(path.join(here('../node_modules/.bin/tsc'))) ? here('../node_modules/.bin/tsc') : 'tsc';
const tscMajor = Number((execFileSync(tscBin, ['-v'], { encoding: 'utf8' }).match(/(\d+)\./) || [])[1] || 5);
const tscArgs = [path.join(src, 'services/permissions.ts'), '--outDir', tmp, '--rootDir', src, '--module', 'commonjs', '--target', 'es2022', '--moduleResolution', 'node', '--skipLibCheck', ...(tscMajor >= 6 ? ['--ignoreConfig', '--ignoreDeprecations', '6.0'] : [])];
try { execFileSync(tscBin, tscArgs, { stdio: 'pipe' }); } catch { /* type errors about react-native are expected here: only the emitted JavaScript is needed */ }
for (const [m, code] of [['react-native', "module.exports={Alert:{alert(){}},Platform:{OS:'ios'}};"], ['@react-native-async-storage/async-storage', "module.exports={default:{getItem:async()=>null,setItem:async()=>{}}};"]]) { fs.mkdirSync(path.join(tmp, 'node_modules', m), { recursive: true }); fs.writeFileSync(path.join(tmp, 'node_modules', m, 'index.js'), code); }
const require = createRequire(import.meta.url);
const P = require(path.join(tmp, 'services/permissions.js'));
const K = require(path.join(tmp, 'data/constants.js'));

const PORT = 18130, base = `http://localhost:${PORT}`;
const srv = spawn('node', ['--no-warnings', here('./server.mjs')], { env: { ...process.env, PORT, DATA_DIR: tmp, DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'parity', TRUST_PROXY: '1', BOOTSTRAP: '0711000001:secretary,0711000002:pastor', NODE_ENV: '', SMS_PROVIDER: 'console' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1300));

let ipN = 1, phoneN = 100;
const call = async (method, p, token, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.1.${Math.floor(ipN / 250)}.${ipN % 250}`, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
async function signUp(phone, profile) {
  ipN++;
  const o = await call('POST', '/auth/request-otp', null, { phone });
  const v = await call('POST', '/auth/verify', null, { phone, code: o.devCode, profile: { idNumber: String(phoneN), church: 'Test', ...profile } });
  return { token: v.token, user: v.user };
}

// The Church Admin is appointed by the app developer on the platform; do the same here by writing it into the platform database.
{ const pdb = new DatabaseSync(path.join(tmp, 'platform.db')); pdb.prepare('UPDATE churches SET admin_phone=? WHERE is_default=1').run('0711000003'); pdb.close(); }
const sec = await signUp('0711000001', { name: 'Secretary' });
const pas = await signUp('0711000002', { name: 'Pastor' });
const adm = await signUp('0711000003', { name: 'Church Admin' });
const mk = async (name, role, groups = [], formerRoles = []) => {
  const u = await signUp('07' + String(20000000 + phoneN++), { name, role, groups, formerRoles });
  if (role) await call('POST', `/users/${u.user.id}/role-decision`, sec.token, { approve: true });
  return { ...u, user: (await call('GET', '/me', u.token)).user };
};

// ---- people to test: every leader role, plus members in different situations
const people = [];
for (const r of K.LEADER_ROLES) if (r.key !== 'secretary' && r.key !== 'pastor') people.push(await mk(r.label, r.key));
people.push({ ...adm, user: (await call('GET', '/me', adm.token)).user }, { ...sec, user: (await call('GET', '/me', sec.token)).user }, { ...pas, user: (await call('GET', '/me', pas.token)).user });
people.push(await mk('Member Dorcas', null, ['dorcas']));
people.push(await mk('Member None', null, []));
people.push(await mk('Member Men Youth', null, ['men', 'youth']));
people.push(await mk('Former Leader', null, ['men'], ['elder1', 'treasurer']));
people.push(await mk('Treasurer in Youth', 'treasurer', ['youth']));
const byRole = (r) => people.find((p) => p.user.role === r);
const tre = byRole('treasurer');
const GROUPS = K.GROUPS.map((g) => g.key);
const leaderOf = (g) => people.find((p) => K.LEADER_ROLES.find((r) => r.key === p.user.role)?.leadsGroup === g);

// ---- seed data so "can they see it" questions have something to see
await call('POST', '/records/notices', pas.token, { board: 'church', title: 'seed', body: 'x' });
await call('POST', '/records/notices', pas.token, { board: 'camp', title: 'seed', body: 'x' });
for (const g of GROUPS) await call('POST', '/records/notices', leaderOf(g).token, { board: 'group', groupKey: g, title: 'seed', body: 'x' });
await call('POST', '/records/memberships', sec.token, { fullName: 'Seed', entry: 'baptism' });
await call('POST', '/records/minutes', sec.token, { kind: 'Church Board', title: 'seed', body: 'x' });
await call('POST', '/records/care', pas.token, { cadence: 'daily', title: 'seed', body: 'x' });
await call('POST', '/records/welfare', sec.token, { fund: 'Burial and Benevolent Fund', title: 'seed', amount: 1 });
const payer = await mk('Payer', null, []);
await call('POST', '/records/office', byRole('sabbath_school').token, { office: 'sabbath_school', kind: 'attendance', date: '2029-01-06', classes: [{ name: 'Adult', enrolled: 5, present: 4 }] });
await call('POST', '/records/office', byRole('building').token, { office: 'building', kind: 'pledge', pledger: 'Seed', amount: 5 });
let codeN = 1000000;
const newPayment = () => call('POST', '/records/payments', payer.token, { mpesaCode: 'PAR' + String(codeN++).padStart(7, '0'), mpesaName: 'P', purpose: 'x', amount: 100, allocations: [{ category: 'Tithe', percent: 100 }] });
await newPayment();

// ---- the questions. Each: [name, what the app says, what the server does]
const ok = (s) => s.status !== 403 && s.status !== 401;
let dayN = 0, campN = 1;
const pending = []; // mismatches
let checks = 0;
const compare = (who, name, app, server) => { checks++; if (!!app !== !!server) pending.push(`${who.user.name} (${who.user.role}): ${name}: app says ${app ? 'YES' : 'no'}, server says ${server ? 'YES' : 'no'}`); };

for (const p of people) {
  const u = p.user, who = p;
  // post on church board / camp board
  compare(who, 'post on the church board', P.canPostChurchBoard(u), ok(await call('POST', '/records/notices', p.token, { board: 'church', title: 't', body: 'b' })));
  compare(who, 'post on the camp board', P.canPostCampBoard(u), ok(await call('POST', '/records/notices', p.token, { board: 'camp', title: 't', body: 'b' })));
  // archive church / camp notices (fresh notice each time, made by the Pastor)
  for (const [board, fn, name] of [['church', P.canArchiveChurchBoard, 'archive a church notice'], ['camp', P.canArchiveCampBoard, 'archive a camp notice']]) {
    const n = (await call('POST', '/records/notices', pas.token, { board, title: 't', body: 'b' })).record;
    compare(who, name, fn(u), ok(await call('POST', `/records/notices/${n.id}/archive`, p.token, {})));
  }
  // group boards
  for (const g of GROUPS) {
    const r = await call('POST', '/records/notices', p.token, { board: 'group', groupKey: g, title: 't', body: 'b' });
    compare(who, `post on the ${g} board`, P.canPostGroupBoard(u, g), ok(r));
    if (ok(r)) compare(who, `${g} board: post needs approval`, P.groupPostNeedsApproval(u, g), r.record.status === 'pending');
    const mine = (await call('GET', '/records/notices', p.token)).records.some((n) => n.board === 'group' && n.groupKey === g && n.status === 'published' && n.title === 'seed');
    compare(who, `see the ${g} board`, P.canViewGroupBoard(u, g), mine);
    // approve: a pending post is made by an ordinary member of that group (or by the Treasurer-in-Youth style person); use the Pastor, who always needs approval
    const pend = (await call('POST', '/records/notices', pas.token, { board: 'group', groupKey: g, title: 'needs approval', body: 'b' })).record;
    compare(who, `approve a ${g} post`, P.canApproveGroupPost(u, g), ok(await call('POST', `/notices/${pend.id}/approve`, p.token)));
    const arch = (await call('POST', '/records/notices', leaderOf(g).token, { board: 'group', groupKey: g, title: 't', body: 'b' })).record;
    compare(who, `archive a ${g} post`, P.canArchiveGroupBoard(u, g), ok(await call('POST', `/records/notices/${arch.id}/archive`, p.token, {})));
  }
  // activities
  for (const g of ['church', 'dorcas', 'treasurer']) {
    const r = await call('POST', '/records/activities', p.token, { groupKey: g, title: 't', date: '2026-12-01' });
    compare(who, `plan an activity for ${g}`, P.canPlanActivity(u, g), ok(r));
    const seed = (await call('POST', '/records/activities', pas.token, { groupKey: g, title: 'seed', date: '2026-12-02' })).record;
    compare(who, `archive an activity of ${g}`, P.canArchiveActivity(u, g), ok(await call('POST', `/records/activities/${seed.id}/archive`, p.token, {})));
  }
  // membership
  compare(who, 'add a member', P.canManageMembership(u), ok(await call('POST', '/records/memberships', p.token, { fullName: 'T', entry: 'baptism' })));
  const app = (await call('POST', '/records/memberships', sec.token, { fullName: 'Applicant', entry: 'transfer', fromChurch: 'X' })).record;
  compare(who, 'decide a transfer', P.canDecideTransfer(u), ok(await call('POST', `/memberships/${app.id}/decide`, p.token, { approve: false })));
  compare(who, 'view membership records', P.canViewMembership(u), (await call('GET', '/records/memberships', p.token)).records.some((r) => r.createdBy !== u.id));
  compare(who, 'read the yearly church report', P.canSeeYearlyReport(u), ok(await call('GET', `/reports/yearly/${new Date().getFullYear()}`, p.token)));
  compare(who, 'see reconciliation', P.canSeeReconciliation(u), ok(await call('GET', `/finance/reconciliation?from=${new Date().toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}`, p.token)));
  compare(who, 'read the membership roll', P.canViewMembership(u), ok(await call('GET', '/membership/roll', p.token)));
  const rollRec = (await call('POST', '/records/memberships', sec.token, { fullName: 'Roll Seed', entry: 'baptism', baptismDate: '2020-01-01' })).record;
  compare(who, 'change a member\'s roll status', P.canManageMembership(u), ok(await call('POST', `/memberships/${rollRec.id}/status`, p.token, { status: 'inactive' })));
  compare(who, 'issue a letter', P.canIssueLetters(u), ok(await call('GET', `/membership/${rollRec.id}/letter?type=baptism`, p.token)));
  // money
  const pay = (await newPayment()).record;
  compare(who, 'receive a payment', P.canReceivePayments(u), ok(await call('POST', `/payments/${pay.id}/receive`, p.token, {})));
  compare(who, 'see everyone\'s payments', P.canViewAllPayments(u), (await call('GET', '/records/payments', p.token)).records.some((r) => r.createdBy !== u.id));
  compare(who, 'record welfare', P.canManageWelfare(u), ok(await call('POST', '/records/welfare', p.token, { fund: 'Burial and Benevolent Fund', title: 't', amount: 1 })));
  compare(who, 'record building project entries', P.canManageProject(u), ok(await call('POST', '/records/projects', p.token, { project: 'Church Building', kind: 'update', title: 't' })));
  // minutes
  compare(who, 'write minutes', P.canWriteMinutes(u), ok(await call('POST', '/records/minutes', p.token, { kind: 'Church Board', title: 't', body: 'b' })));
  compare(who, 'read minutes', P.canReadMinutes(u), (await call('GET', '/records/minutes', p.token)).records.some((r) => r.title === 'seed'));
  // office tools
  const day = () => '2030-' + String(1 + (dayN % 12)).padStart(2, '0') + '-' + String(1 + Math.floor(dayN++ / 12)).padStart(2, '0');
  compare(who, 'keep the Sabbath School register', P.canKeepAttendance(u), ok(await call('POST', '/records/office', p.token, { office: 'sabbath_school', kind: 'attendance', date: day(), classes: [{ name: 'Adult', enrolled: 5, present: 4 }], visitors: 0 })));
  compare(who, 'read the Sabbath School register', P.canReadAttendance(u), (await call('GET', '/records/office', p.token)).records.some((r) => r.kind === 'attendance' && r.createdBy !== u.id) || P.canKeepAttendance(u));
  compare(who, 'keep building pledges', P.canKeepPledges(u), ok(await call('POST', '/records/office', p.token, { office: 'building', kind: 'pledge', pledger: 'X', amount: 100 })));
  compare(who, 'read building pledges', P.canReadPledges(u), (await call('GET', '/records/office', p.token)).records.some((r) => r.kind === 'pledge' && r.createdBy !== u.id) || P.canKeepPledges(u));
  const reg = (await call('POST', '/records/campreg', payer.token, { camp: 'Camp ' + (campN++), category: 'adult', accommodation: 'tent', days: 2 })).record;
  compare(who, 'run camp registrations (set a fee)', P.canManageCamp(u), ok(await call('POST', `/camp/registrations/${reg.id}/action`, p.token, { action: 'fee', amount: 100 })));
  compare(who, 'see everyone\'s camp registrations', P.canSeeAllCampRegistrations(u), (await call('GET', '/records/campreg', p.token)).records.some((r) => r.createdBy !== u.id));
  compare(who, 'cancel (archive) a camp registration', P.canManageCamp(u), ok(await call('POST', `/records/campreg/${reg.id}/archive`, p.token, {})));
  // pastoral care
  compare(who, 'post a care message', P.canPostCare(u), ok(await call('POST', '/records/care', p.token, { cadence: 'daily', title: 't', body: 'b' })));
  compare(who, 'record a sermon', P.canRecordSermon(u), ok(await call('POST', '/records/sermons', p.token, { title: 't', audience: 'general', summary: 's' })));
  const care = (await call('POST', '/records/care', pas.token, { cadence: 'daily', title: 't', body: 'b' })).record;
  compare(who, 'archive a care message', P.canArchiveCare(u), ok(await call('POST', `/records/care/${care.id}/archive`, p.token, {})));
}

srv.kill();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${people.length} kinds of people, ${checks} questions asked of both the app rules and the server.`);
if (pending.length) { console.log(`\nFAIL ${pending.length} disagreement(s):`); for (const m of [...new Set(pending)].slice(0, 60)) console.log('  ' + m); }
else console.log('PASS the app and the server agree on every question');
console.log(`\n${pending.length ? 0 : 1} passed, ${pending.length ? 1 : 0} failed`);
process.exit(pending.length ? 1 : 0);
