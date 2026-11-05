// Tests for the multi-church platform: developer console (team of up to 10), church cloning and church numbers, independence
// of churches, binding and moving, Church Admin console, and the support chat.
// Run: node --no-warnings test-console.mjs   (starts its own server on a temporary folder)
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = (f) => new URL(f, import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-console-'));
const PORT = 18140, base = `http://localhost:${PORT}`;
const SECRET = 'ab'.repeat(16);
const env = { ...process.env }; for (const k of Object.keys(env)) if (/^(DEFAULT_CHURCH|BOOTSTRAP|DEVELOPERS|DB_FILE|MPESA_|SMS_|NODE_ENV)/.test(k)) delete env[k];
const srv = spawn('node', ['--no-warnings', here('./server.mjs')], { env: { ...env, PORT, DATA_DIR: dir, TOKEN_SECRET: 'console-test', TRUST_PROXY: '1', DEVELOPERS: '0700000001:Amina Dev', MPESA_CALLBACK_SECRET: SECRET }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1300));

let pass = 0, fail = 0, ipN = 1;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const call = async (method, p, token, body) => {
  ipN++;
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.2.${Math.floor(ipN / 250)}.${ipN % 250}`, ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
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
  // ---------------------------------------------------------------- developer team
  const bad = await devLogin('0700000999');
  ok('a phone that is not on the developer team cannot open the developer console', bad.status === 403 && !bad.token);
  const d1 = await devLogin('0700000001');
  ok('the first developer (from DEVELOPERS) signs in', !!d1.token && d1.developer.name === 'Amina Dev' && d1.limit === 10);
  const D = d1.token;
  ok('developer routes refuse a missing token', (await call('GET', '/dev/churches')).status === 401);

  for (let i = 2; i <= 10; i++) { const r = await call('POST', '/dev/team', D, { phone: `07000000${String(i).padStart(2, '0')}`, name: 'Dev ' + i }); if (r.status !== 200) { ok('add developer ' + i, false, JSON.stringify(r)); } }
  const team = await call('GET', '/dev/team', D);
  ok('ten developers can be active', team.active === 10 && team.developers.length === 10);
  const eleventh = await call('POST', '/dev/team', D, { phone: '0700000011', name: 'Dev 11' });
  ok('an 11th developer is refused (limit is 10)', eleventh.status === 409 && /full/.test(eleventh.error), JSON.stringify(eleventh));
  const dev10 = team.developers.find((d) => d.phone === '0700000010');
  const arch = await call('POST', `/dev/team/${dev10.id}/archive`, D);
  ok('a developer can be archived (not deleted)', arch.status === 200 && arch.developer.status === 'archived' && arch.active === 9);
  ok('an archived developer can no longer sign in', (await devLogin('0700000010')).status === 403);
  const add11 = await call('POST', '/dev/team', D, { phone: '0700000011', name: 'Dev 11' });
  ok('after archiving, a new developer can join', add11.status === 200);
  ok('the archived developer cannot be restored while the team is full', (await call('POST', `/dev/team/${dev10.id}/restore`, D)).status === 409);
  ok('you cannot archive yourself', (await call('POST', `/dev/team/${team.developers.find((d) => d.phone === '0700000001').id}/archive`, D)).status === 409);

  // ---------------------------------------------------------------- creating (cloning) churches
  const tpl = await call('POST', '/dev/template', D, { template: { paybill: '', categories: ['Tithe', 'Offering', 'Camp Meeting'], language: 'sw' } });
  ok('the template every church is cloned from can be changed', tpl.template?.categories.length === 3 && tpl.template.language === 'sw');
  const A = (await call('POST', '/dev/churches', D, { name: 'Kisumu Central SDA Church', adminPhone: '0711000001', district: 'Kisumu', county: 'Kisumu' })).church;
  const B = (await call('POST', '/dev/churches', D, { name: 'Nakuru Town SDA Church', adminPhone: '0722000001' })).church;
  ok('each church gets its own church number', /^\d{3}-\d{4}$/.test(A.number) && /^\d{3}-\d{4}$/.test(B.number) && A.number !== B.number, A.number + ' ' + B.number);
  ok('the church name is written on the church', A.name === 'Kisumu Central SDA Church' && A.status === 'active');
  ok('a church with too short a name is refused', (await call('POST', '/dev/churches', D, { name: 'ab' })).status === 400);
  ok('a mistyped church number (bad check digit) is refused', (await call('POST', '/dev/churches', D, { name: 'Test Church X', number: '1234567' })).status === 400);
  const dupe = await call('POST', '/dev/churches', D, { name: 'Another Church', number: A.number.replace('-', '') });
  ok('a church number can only be assigned once', dupe.status === 409);
  const C = (await call('POST', '/dev/churches', D, { name: 'Eldoret East SDA Church', cloneFrom: A.id })).church;
  const Cd = await call('GET', `/dev/churches/${C.id}`, D);
  ok('a church cloned from another starts with that church\'s settings but none of its data', Cd.settings.language === 'sw' && Cd.church.members === 0 && Cd.church.clonedFrom === A.id);
  ok('an admin phone that belongs to a developer is refused', (await call('POST', '/dev/churches', D, { name: 'Bad Admin Church', adminPhone: '0700000002' })).status === 409);

  // ---------------------------------------------------------------- joining with the church number
  const noNumCode = await otp('0733000001');
  const noNum = await call('POST', '/auth/verify', null, { phone: '0733000001', code: noNumCode, profile: { name: 'No Number', idNumber: '8888888' } });
  ok('without a church number a new person cannot sign up', noNum.status === 400 && /church number/i.test(noNum.error), JSON.stringify(noNum));
  const wrongNum = await call('POST', '/auth/verify', null, { phone: '0733000001', code: noNumCode, churchNumber: '1234567', profile: { name: 'Wrong Number', idNumber: '9999999' } });
  ok('a wrong church number is refused', wrongNum.status === 404);
  const adminA = await signUp('0711000001', A.number, 'Grace Admin');
  ok('the church admin appointed by the developer becomes Church Admin of that church', adminA.user?.role === 'church_admin' && adminA.church.name === A.name, JSON.stringify(adminA));
  const adminB = await signUp('0722000001', B.number, 'Brian Admin');
  ok('the other church has its own admin', adminB.user?.role === 'church_admin' && adminB.church.name === B.name);
  const m1 = await signUp('0733000010', A.number, 'Mary Member');
  ok('a new member who enters the church number waits for the admin', m1.user && (await call('GET', '/records/notices', m1.token)).code === 'join_pending');
  const meA = await call('GET', '/me', adminA.token);
  ok('/me tells the admin the church number', meA.church.number === A.number && meA.settings.language === 'sw');
  const list = await call('GET', '/admin/members', adminA.token);
  const pend = list.members.find((m) => m.phone === '0733000010');
  ok('the admin sees the person waiting to join', pend?.joinStatus === 'pending');
  const ap = await call('POST', `/admin/members/${pend.id}/join`, adminA.token, { approve: true });
  ok('the admin lets the member in', ap.member?.joinStatus === 'approved');
  ok('the approved member can now use the church', (await call('GET', '/records/notices', m1.token)).status === 200);
  ok('a member cannot call admin routes', (await call('GET', '/admin/members', m1.token)).status === 403);
  ok('a developer token cannot call member routes, and a member token cannot call developer routes', (await call('GET', '/records/notices', D)).status === 401 && (await call('GET', '/dev/churches', m1.token)).status === 401);

  // ---------------------------------------------------------------- independence of churches
  await call('POST', '/admin/members', adminA.token, { phone: '0733000020', name: 'Sec A', role: 'secretary' });
  const secA = await signIn('0733000020');
  ok('a member added by the admin signs in with just the phone (already bound to the church)', !!secA.token && secA.user.role === 'secretary' && secA.church.name === A.name, JSON.stringify(secA));
  const note = await call('POST', '/records/notices', secA.token, { board: 'church', title: 'Only for Kisumu', body: 'Hello Kisumu' });
  ok('a leader posts on the church board', note.status === 200 || !!note.record);
  const adminBoardPost = await call('POST', '/records/notices', adminB.token, { board: 'church', title: 'Only for Nakuru', body: 'Hello Nakuru' });
  const seenInB = await call('GET', '/records/notices', adminB.token);
  ok('Church B never sees Church A\'s notices', !seenInB.records.some((r) => r.title === 'Only for Kisumu') && seenInB.records.some((r) => r.title === 'Only for Nakuru'));
  const seenInA = await call('GET', '/records/notices', m1.token);
  ok('Church A never sees Church B\'s notices', !seenInA.records.some((r) => r.title === 'Only for Nakuru') && seenInA.records.some((r) => r.title === 'Only for Kisumu'));
  const usersB = await call('GET', '/users', adminB.token);
  ok('Church B\'s people list has only Church B people', usersB.users.every((u) => u.church === B.name) && !usersB.users.some((u) => u.phone === '0711000001'));
  const files = fs.readdirSync(path.join(dir, 'churches')).filter((f) => f.endsWith('.db'));
  ok('every church has its own database file', files.length >= 3, files.join());

  // ---------------------------------------------------------------- admin console: add / archive ("delete") members and activities
  const addB = await call('POST', '/admin/members', adminB.token, { phone: '0733000010', name: 'Takes Mary' });
  ok('a phone that already belongs to another church cannot be added', addB.status === 409 && /another church/.test(addB.error));
  const add = await call('POST', '/admin/members', adminA.token, { phone: '0733000030', name: 'John Youth', groups: ['youth'] });
  ok('the admin adds a member', add.member?.name === 'John Youth' && add.member.groups.includes('youth'));
  ok('adding the same phone again is refused', (await call('POST', '/admin/members', adminA.token, { phone: '0733000030', name: 'John Youth' })).status === 409);
  const johnIn = await signIn('0733000030');
  const del = await call('POST', `/admin/members/${add.member.id}/archive`, adminA.token, { reason: 'left the church' });
  ok('the admin "deletes" a member: the member is archived', del.archived === true);
  ok('an archived member\'s token stops working', (await call('GET', '/me', johnIn.token)).status === 401);
  const johnCode = await otp('0733000030');
  const johnBack = await call('POST', '/auth/verify', null, { phone: '0733000030', code: johnCode });
  ok('an archived member cannot just sign in again (no longer bound to the church)', johnBack.status === 400 && !johnBack.token);
  const arc = await call('GET', '/admin/members?archived=1', adminA.token);
  ok('the archived member is still in the list (nothing deleted)', arc.members.some((m) => m.id === add.member.id && m.archived));
  const res = await call('POST', `/admin/members/${add.member.id}/restore`, adminA.token);
  ok('the admin can restore an archived member', res.member?.archived === false && !!(await call('POST', '/auth/verify', null, { phone: '0733000030', code: johnCode })).token);
  ok('the admin cannot archive themselves', (await call('POST', `/admin/members/${adminA.user.id}/archive`, adminA.token, {})).status === 403);
  const role = await call('POST', `/admin/members/${add.member.id}/role`, adminA.token, { role: 'youth_leader' });
  ok('the admin can set a member\'s position', role.member?.role === 'youth_leader');
  const act = await call('POST', '/records/activities', adminA.token, { groupKey: 'youth', title: 'Youth Sabbath', date: '2026-11-07', details: 'Programme' });
  ok('the admin adds an activity', !!act.record, JSON.stringify(act));
  const actArch = await call('POST', `/records/activities/${act.record.id}/archive`, adminA.token, { reason: 'cancelled' });
  ok('the admin "deletes" an activity: it is archived', actArch.status === 200);
  const delMethod = await fetch(base + `/records/activities/${act.record.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + adminA.token } });
  ok('the HTTP DELETE method is refused everywhere', delMethod.status === 405);
  const st = await call('POST', '/admin/settings', adminA.token, { settings: { paybill: '600111', language: 'en', requireJoinApproval: false } });
  ok('the admin sets the church Pay Bill and language', st.settings?.paybill === '600111' && st.settings.language === 'en');
  ok('members of that church see the church\'s own Pay Bill', (await call('GET', '/me', m1.token)).settings.paybill === '600111');
  ok('another church\'s Pay Bill is unchanged', (await call('GET', '/me', adminB.token)).settings.paybill === '');
  ok('the admin overview counts people', (await call('GET', '/admin/overview', adminA.token)).counts.members >= 3);

  // ---------------------------------------------------------------- M-Pesa goes to the church that owns the Pay Bill
  const hook = await call('POST', `/hooks/c2b/${SECRET}/confirmation`, null, { TransID: 'QWE1234567', TransAmount: '500', BusinessShortCode: '600111', BillRefNumber: 'Mary', FirstName: 'Mary', TransTime: '20261023120000' });
  const dbA = new DatabaseSync(path.join(dir, 'churches', fs.readdirSync(path.join(dir, 'churches')).filter((f) => f.endsWith('.db')).find((f) => { const d = new DatabaseSync(path.join(dir, 'churches', f)); try { return d.prepare("SELECT COUNT(*) n FROM users WHERE phone='0711000001'").get().n === 1; } finally { d.close(); } })));
  const dbB = new DatabaseSync(path.join(dir, 'churches', fs.readdirSync(path.join(dir, 'churches')).filter((f) => f.endsWith('.db')).find((f) => { const d = new DatabaseSync(path.join(dir, 'churches', f)); try { return d.prepare("SELECT COUNT(*) n FROM users WHERE phone='0722000001'").get().n === 1; } finally { d.close(); } })));
  ok('a Pay Bill payment is stored in the church that owns that Pay Bill only', hook.ResultCode === '0' && dbA.prepare('SELECT COUNT(*) n FROM mpesa_tx').get().n === 1 && dbB.prepare('SELECT COUNT(*) n FROM mpesa_tx').get().n === 0);
  dbA.close(); dbB.close();

  // ---------------------------------------------------------------- moving to another church
  await call('POST', '/admin/members/' + pend.id + '/role', adminA.token, { role: 'treasurer' });
  const mary1 = await signIn('0733000010');
  ok('before moving, Mary is Treasurer of church A', mary1.user.role === 'treasurer' && mary1.church.name === A.name);
  const noCode = await call('POST', '/me/move', mary1.token, { churchNumber: B.number, code: '000000' });
  ok('moving needs a fresh SMS code', noCode.status === 400);
  const moved = await call('POST', '/me/move', mary1.token, { churchNumber: B.number, code: await otp('0733000010') });
  ok('Mary moves to church B', !!moved.token && moved.church.name === B.name && moved.user.name === 'Mary Member', JSON.stringify(moved));
  ok('her old leader position becomes an advisory (former leader) role at the new church', moved.user.role === 'former_leader' && moved.user.formerRoles.includes('treasurer'), JSON.stringify(moved.user));
  ok('her old church token stops working', (await call('GET', '/me', mary1.token)).status === 401);
  const mary2 = await signIn('0733000010');
  ok('signing in again lands in church B only', mary2.church?.name === B.name);
  ok('at church B she sees church B\'s notices and not church A\'s', await (async () => { const n = await call('GET', '/records/notices', moved.token); return n.status === 200 ? !n.records.some((r) => r.title === 'Only for Kisumu') : n.code === 'join_pending'; })());
  ok('church A no longer lists her as a member', !(await call('GET', '/admin/members', adminA.token)).members.some((m) => m.phone === '0733000010'));
  ok('church A keeps her history (archived, not deleted)', (await call('GET', '/admin/members?archived=1', adminA.token)).members.some((m) => m.phone === '0733000010' && m.archived));
  const addHer = await call('POST', '/admin/members', adminA.token, { phone: '0733000010', name: 'Mary M' });
  ok('church A cannot add her while she belongs to B', addHer.status === 409, JSON.stringify(addHer));
  ok('a Church Admin cannot just move away', (await call('POST', '/me/move', adminA.token, { churchNumber: B.number, code: await otp('0711000001') })).status === 409);
  const bindings = new DatabaseSync(path.join(dir, 'platform.db'));
  const rows = bindings.prepare("SELECT status FROM bindings WHERE phone='0733000010' ORDER BY since").all().map((r) => r.status);
  ok('the platform keeps the history of bindings: one archived, one active', rows.join() === 'archived,active', rows.join());
  bindings.close();

  // ---------------------------------------------------------------- support chat (the direct line)
  const m0 = await call('POST', '/admin/support', adminA.token, { body: 'Hello developers, our Pay Bill changed.' });
  ok('the church admin writes to the developers', !!m0.message);
  ok('an ordinary member cannot use the support line', (await call('POST', '/admin/support', secA.token, { body: 'hi' })).status === 403);
  ok('an empty message is refused', (await call('POST', '/admin/support', adminA.token, { body: '   ' })).status === 400);
  const inbox = await call('GET', '/dev/support', D);
  ok('the developer inbox shows the church thread with 1 unread', inbox.unread === 1 && inbox.threads[0].church === A.name, JSON.stringify(inbox));
  const d2 = await devLogin('0700000002');
  ok('unread is tracked per developer', (await call('GET', '/dev/support', d2.token)).unread === 1);
  const thread = await call('GET', `/dev/support/${A.id}`, D);
  ok('a developer reads the thread (marks it read for them)', thread.messages.length === 1 && (await call('GET', '/dev/support', D)).unread === 0 && (await call('GET', '/dev/support', d2.token)).unread === 1);
  await call('POST', `/dev/support/${A.id}`, D, { body: 'Hi Grace, please update it under Settings.' });
  const me2 = await call('GET', '/me', adminA.token);
  ok('the admin sees an unread reply count', me2.supportUnread === 1);
  const ad = await call('GET', '/admin/support', adminA.token);
  ok('the admin reads the developer\'s reply (named)', ad.messages.length === 2 && ad.messages[1].from === 'developer' && ad.messages[1].name === 'Amina Dev' && (await call('GET', '/me', adminA.token)).supportUnread === 0);
  ok('church B cannot read church A\'s chat', !(await call('GET', '/admin/support', adminB.token)).messages.length);
  const poll = await call('GET', `/admin/support?after=${encodeURIComponent(ad.messages[1].at)}&read=0`, adminA.token);
  ok('polling with "after" returns only newer messages', poll.messages.length === 0);
  const sm = new DatabaseSync(path.join(dir, 'platform.db')); let edited = true; try { sm.exec("UPDATE support_messages SET body='x'"); } catch { edited = false; } sm.close();
  ok('chat messages cannot be edited afterwards', !edited);

  const pdel = new DatabaseSync(path.join(dir, 'platform.db')); let blocked = 0; for (const sql of ['DELETE FROM churches', 'DELETE FROM bindings', 'DELETE FROM developers', 'DELETE FROM support_messages', 'DELETE FROM paudit']) { try { pdel.exec(sql); } catch { blocked++; } }
  ok('the platform database refuses every delete', blocked === 5);
  pdel.close();

  // ---------------------------------------------------------------- developer controls over a church
  const upd = await call('POST', `/dev/churches/${B.id}/update`, D, { name: 'Nakuru Town Central SDA Church' });
  ok('a developer can change the church name', upd.church?.name === 'Nakuru Town Central SDA Church');
  ok('the new name appears for the church\'s members', (await call('GET', '/me', adminB.token)).church.name === 'Nakuru Town Central SDA Church');
  const newAdmin = await call('POST', `/dev/churches/${B.id}/admin`, D, { phone: '0722000002' });
  ok('a developer appoints a new church admin', newAdmin.church?.adminPhone === '0722000002');
  ok('the old admin becomes an ordinary member', (await call('GET', '/admin/members', adminB.token)).status === 403);
  const sus = await call('POST', `/dev/churches/${A.id}/status`, D, { status: 'suspended', reason: 'unpaid subscription' });
  ok('a developer can pause a church', sus.church?.status === 'suspended');
  const pausedIn = await signIn('0711000001');
  ok('members of a paused church are blocked', (await call('GET', '/me', adminA.token)).status === 401 && pausedIn.status === 403, JSON.stringify(pausedIn));
  await call('POST', `/dev/churches/${A.id}/status`, D, { status: 'active' });
  ok('and it comes back when re-activated, with all its data', (await call('GET', '/records/notices', (await signIn('0711000001')).token)).records.some((r) => r.title === 'Only for Kisumu'));
  const list2 = await call('GET', '/dev/churches', D);
  ok('the developer sees every church with member counts and unread messages (but no church data)', list2.churches.length === 3 && !JSON.stringify(list2).includes('Only for Kisumu'));
  ok('the platform audit trail records developer actions', (await call('GET', '/dev/audit', D)).entries.some((e) => e.action === 'church.create'));
  const page = await fetch(base + '/console'); const html = await page.text();
  ok('the developer console page is served', page.status === 200 && /text\/html/.test(page.headers.get('content-type')) && /Developer Console/i.test(html));
  const delDev = await fetch(base + `/dev/churches/${A.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + D } });
  ok('a church cannot be deleted through the API', delDev.status === 405);
} catch (e) { fail++; console.log('ERROR', e); }

srv.kill();
await new Promise((r) => setTimeout(r, 300));
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
