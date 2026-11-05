// End-to-end tests. Run: node --no-warnings test.mjs   (starts its own server on a temporary database)
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-test-'));
const DB_FILE = path.join(dir, 't.db');
const PORT = 18080;
const srv = spawn('node', ['--no-warnings', new URL('./server.mjs', import.meta.url).pathname], {
  env: { ...process.env, PORT, DB_FILE, DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'test', BOOTSTRAP: '0711000001:secretary,0711000002:pastor' }, stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 900));
const base = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + extra)); };
const call = async (method, p, token, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
async function login(phone, profile) {
  const o = await call('POST', '/auth/request-otp', null, { phone });
  const v = await call('POST', '/auth/verify', null, { phone, code: o.devCode, profile });
  return { token: v.token, user: v.user, status: v.status, error: v.error };
}
const prof = (name, extra = {}) => ({ name, idNumber: '2' + Math.floor(Math.random() * 1e7), church: 'Test SDA Church', ...extra });

try {
  // ---- login & roles
  const sec = await login('0711000001', prof('Ruth Njeri', { role: 'member' }));
  const pas = await login('0711000002', prof('Pastor John'));
  ok('bootstrap secretary is approved with role secretary', sec.user?.role === 'secretary' && sec.user.roleStatus === 'approved');
  ok('bootstrap pastor approved', pas.user?.role === 'pastor');

  const bad = await call('POST', '/auth/verify', null, { phone: '0733000001', code: '000000', profile: prof('X') });
  ok('wrong OTP rejected', bad.status === 400);

  const tre = await login('0733000002', prof('Daniel Treasurer', { role: 'treasurer' }));
  ok('self-chosen Treasurer is PENDING and acts as member', tre.user.roleStatus === 'pending' && tre.user.role === 'member');
  const mem = await login('0722000001', prof('Grace Member', { groups: ['dorcas'] }));
  const mem2 = await login('0722000002', prof('Peter Member', { groups: ['men'] }));
  const dor = await login('0733000003', prof('Mary Dorcas', { role: 'dorcas_leader', groups: ['dorcas'] }));

  const pre = await call('POST', '/payments/x/receive', tre.token);
  ok('pending treasurer cannot receive payments', pre.status === 403);
  const selfApprove = await call('POST', `/users/${tre.user.id}/role-decision`, tre.token, { approve: true });
  ok('user cannot approve own role', selfApprove.status === 403);
  const memApprove = await call('POST', `/users/${tre.user.id}/role-decision`, mem.token, { approve: true });
  ok('plain member cannot approve roles', memApprove.status === 403);
  const pend = await call('GET', '/users/pending-roles', sec.token);
  ok('secretary sees pending leader roles', pend.users.length === 2);
  await call('POST', `/users/${tre.user.id}/role-decision`, sec.token, { approve: true });
  await call('POST', `/users/${dor.user.id}/role-decision`, pas.token, { approve: true });
  const me2 = await call('GET', '/me', tre.token);
  ok('after approval treasurer role is active', me2.user.role === 'treasurer' && me2.user.roleStatus === 'approved');

  // ---- payment flow
  const pay = (over = {}) => ({ mpesaCode: 'SGH7K2L9QX', mpesaName: 'GRACE W', purpose: 'Monthly tithe', amount: 1000, allocations: [{ category: 'Tithe', percent: 10 }, { category: 'Offering', percent: 20 }, { category: 'Church Budget', percent: 70 }], ...over });
  const badSplit = await call('POST', '/records/payments', mem.token, pay({ allocations: [{ category: 'Tithe', percent: 10 }, { category: 'Offering', percent: 20 }] }));
  ok('split not totalling 100% rejected', badSplit.status === 400);
  const badCode = await call('POST', '/records/payments', mem.token, pay({ mpesaCode: 'abc' }));
  ok('invalid M-Pesa code rejected', badCode.status === 400);
  const p1 = await call('POST', '/records/payments', mem.token, pay());
  ok('payment submitted, status pending, amounts computed', p1.record?.status === 'pending' && p1.record.allocations.map((a) => a.amount).join() === '100,200,700');
  const dup = await call('POST', '/records/payments', mem2.token, pay());
  ok('duplicate M-Pesa code rejected', dup.status === 409);
  const forged = await call('POST', '/records/payments', mem.token, pay({ mpesaCode: 'ZZZ1234567', memberId: 'someone-else', status: 'received' }));
  ok('member cannot forge owner or status', forged.record?.memberId === mem.user.id && forged.record.status === 'pending');

  const tlist = await call('GET', '/records/payments', tre.token);
  ok('treasurer sees all payments', tlist.records.length === 2);
  const m2list = await call('GET', '/records/payments', mem2.token);
  ok("other member cannot see someone else's payments", m2list.records.length === 0);
  const memRecv = await call('POST', `/payments/${p1.record.id}/receive`, mem.token);
  ok('member cannot mark own payment received', memRecv.status === 403);
  const rcv = await call('POST', `/payments/${p1.record.id}/receive`, tre.token);
  ok('treasurer receive issues a receipt', rcv.receipt?.receiptNo === 'RCT-00001' && rcv.receipt.text.includes('KSh 1,000'));
  const again = await call('POST', `/payments/${p1.record.id}/receive`, tre.token);
  ok('cannot receive the same payment twice', again.status === 409);
  const myReceipts = await call('GET', '/records/receipts', mem.token);
  ok('member gets the receipt automatically', myReceipts.records.length === 1 && myReceipts.records[0].memberId === mem.user.id);
  const otherReceipts = await call('GET', '/records/receipts', mem2.token);
  ok("other member cannot see this member's receipt", otherReceipts.records.length === 0);

  // ---- archive-only
  const del = await call('DELETE', `/records/payments/${p1.record.id}`, tre.token);
  ok('HTTP DELETE refused (405)', del.status === 405);
  const raw = new DatabaseSync(DB_FILE);
  let blocked = false; try { raw.exec('DELETE FROM records'); } catch (e) { blocked = /Archive only/.test(String(e.message)); }
  ok('database itself refuses DELETE on records', blocked);
  blocked = false; try { raw.exec('DELETE FROM audit'); } catch { blocked = true; }
  ok('audit trail cannot be deleted', blocked);
  blocked = false; try { raw.exec("UPDATE audit SET detail='x'"); } catch { blocked = true; }
  ok('audit trail cannot be edited', blocked);
  raw.close();

  // ---- church notice board
  const nm = await call('POST', '/records/notices', mem.token, { board: 'church', title: 'Hi', body: 'x' });
  ok('plain member cannot post on church board', nm.status === 403);
  const n1 = await call('POST', '/records/notices', pas.token, { board: 'church', title: 'Board meeting', body: 'Sunday 2pm' });
  ok('leader posts on church board (published)', n1.record?.status === 'published');
  const arTre = await call('POST', `/records/notices/${n1.record.id}/archive`, tre.token, {});
  ok('only Church Secretary may archive church notices (treasurer refused)', arTre.status === 403);
  const arSec = await call('POST', `/records/notices/${n1.record.id}/archive`, sec.token, { reason: 'Past event' });
  ok('secretary archives church notice', arSec.archived === true);
  const visible = await call('GET', '/records/notices', mem.token);
  ok('archived notice hidden from members', !visible.records.some((n) => n.id === n1.record.id));
  const withArch = await call('GET', '/records/notices?archived=1', sec.token);
  ok('archived notice still kept and visible to secretary', withArch.records.some((n) => n.id === n1.record.id && n.archived));

  // ---- group board with approval
  const g1 = await call('POST', '/records/notices', mem.token, { board: 'group', groupKey: 'dorcas', title: 'Visit', body: 'Sat' });
  ok('group member post is PENDING', g1.record?.status === 'pending');
  const gOutsider = await call('POST', '/records/notices', mem2.token, { board: 'group', groupKey: 'dorcas', title: 'x', body: 'y' });
  ok('non-member cannot post on that group board', gOutsider.status === 403);
  const gSeeOut = await call('GET', '/records/notices', mem2.token);
  ok('non-member cannot see the group board', !gSeeOut.records.some((n) => n.board === 'group'));
  const selfAp = await call('POST', `/notices/${g1.record.id}/approve`, mem.token);
  ok('author cannot approve own group post', selfAp.status === 403);
  const gl = await call('GET', '/records/notices', dor.token);
  ok('group leader sees pending post', gl.records.some((n) => n.id === g1.record.id));
  await call('POST', `/notices/${g1.record.id}/approve`, dor.token);
  const gl2 = await call('GET', '/records/notices', mem.token);
  ok('after approval it is published', gl2.records.find((n) => n.id === g1.record.id)?.status === 'published');
  const lead = await call('POST', '/records/notices', dor.token, { board: 'group', groupKey: 'dorcas', title: 'Leader post', body: 'z' });
  ok('group leader posts freely (published)', lead.record?.status === 'published');
  const cheat = await call('POST', '/records/notices', mem.token, { board: 'group', groupKey: 'dorcas', title: 'c', body: 'c', status: 'published' });
  ok('member cannot self-publish by sending status', cheat.record?.status === 'pending');

  // ---- camp board
  ok('member cannot post on camp board', (await call('POST', '/records/notices', mem.token, { board: 'camp', title: 'a', body: 'b' })).status === 403);
  ok('pastor posts on camp board', (await call('POST', '/records/notices', pas.token, { board: 'camp', title: 'Camp', body: 'b' })).record?.status === 'published');

  // ---- minutes & membership
  ok('member cannot add minutes', (await call('POST', '/records/minutes', mem.token, { kind: 'Church Board', title: 't', body: 'b' })).status === 403);
  ok('secretary adds minutes', !!(await call('POST', '/records/minutes', sec.token, { kind: 'Church Board', title: 'Sept', body: 'b' })).record);
  ok('member cannot read minutes', (await call('GET', '/records/minutes', mem.token)).records.length === 0);
  const tr = await call('POST', '/records/memberships', sec.token, { fullName: 'Joseph N', idNumber: '1', entry: 'transfer', status: 'application', fromChurch: 'Nyeri' });
  ok('secretary submits transfer application', !!tr.record);
  ok('secretary cannot decide a transfer', (await call('POST', `/memberships/${tr.record.id}/decide`, sec.token, { approve: true })).status === 403);
  await call('POST', `/memberships/${tr.record.id}/decide`, pas.token, { approve: true });
  const ml = await call('GET', '/records/memberships', pas.token);
  ok('pastor approves transfer, member number assigned', ml.records[0].status === 'active' && ml.records[0].memberNumber === 'M-0001');
  ok('member cannot read membership records', (await call('GET', '/records/memberships', mem.token)).records.length === 0);

  // ---- login code survives the profile step (new people) and baptism numbering
  const o2 = await call('POST', '/auth/request-otp', null, { phone: '0744000001' });
  const noProf = await call('POST', '/auth/verify', null, { phone: '0744000001', code: o2.devCode });
  ok('new person without profile is asked for it (code not used up)', noProf.status === 400 && /profile/.test(noProf.error));
  const withProf = await call('POST', '/auth/verify', null, { phone: '0744000001', code: o2.devCode, profile: prof('New Person') });
  ok('same code then works with the profile', !!withProf.token);
  const reuse = await call('POST', '/auth/verify', null, { phone: '0744000001', code: o2.devCode });
  ok('code cannot be used a second time', reuse.status === 400);
  const bap = await call('POST', '/records/memberships', sec.token, { fullName: 'Mercy W', idNumber: '2', entry: 'baptism', status: 'application', memberNumber: 'HACK' });
  ok('baptism goes straight to active with a server-assigned number', bap.record?.status === 'active' && /^M-\d{4}$/.test(bap.record.memberNumber));
  const tr2 = await call('POST', '/records/memberships', sec.token, { fullName: 'Fake Transfer', entry: 'transfer', status: 'active' });
  ok('transfer cannot skip the Church Board', tr2.record?.status === 'application');

  // ---- members apply for transfer themselves
  const noFrom = await call('POST', '/membership/apply', mem2.token, {});
  ok('application without the previous church is refused', noFrom.status === 400);
  const ap = await call('POST', '/membership/apply', mem2.token, { fromChurch: 'Nyeri Town SDA', transferLetterRef: 'TL/9', fullName: 'Someone Else', status: 'active', applicantId: 'forged' });
  ok('a member can apply; name comes from the account and the status is "application"', ap.record?.status === 'application' && ap.record.fullName === 'Peter Member' && ap.record.applicantId === mem2.user.id && ap.record.entry === 'transfer', JSON.stringify(ap));
  ok('a second application while one is waiting is refused', (await call('POST', '/membership/apply', mem2.token, { fromChurch: 'X' })).status === 409);
  ok('the applicant can see their own application', (await call('GET', '/records/memberships', mem2.token)).records.some((r) => r.id === ap.record.id));
  ok("another member cannot see someone else's application", !(await call('GET', '/records/memberships', mem.token)).records.some((r) => r.id === ap.record.id));
  ok('the Secretary cannot forge the applicant link when adding a record', !(await call('POST', '/records/memberships', sec.token, { fullName: 'F', entry: 'transfer', applicantId: mem.user.id })).record.applicantId);
  ok('the applicant cannot decide their own application', (await call('POST', `/memberships/${ap.record.id}/decide`, mem2.token, { approve: true })).status === 403);
  await call('POST', `/memberships/${ap.record.id}/decide`, pas.token, { approve: true });
  const apAfter = (await call('GET', '/records/memberships', mem2.token)).records.find((r) => r.id === ap.record.id);
  ok('after the Pastor approves: active, with a membership number', apAfter.status === 'active' && /^M-\d{4}$/.test(apAfter.memberNumber), JSON.stringify(apAfter));
  ok("the applicant's own profile now shows the membership number", (await call('GET', '/me', mem2.token)).user.membershipNumber === apAfter.memberNumber);

  // ---- misc security
  ok('no token -> 401', (await call('GET', '/me')).status === 401);
  ok('tampered token -> 401', (await call('GET', '/me', sec.token.slice(0, -3) + 'abc')).status === 401);
  ok('restore: member refused', (await call('POST', `/records/notices/${n1.record.id}/restore`, mem.token)).status === 403);
  ok('restore: secretary allowed', (await call('POST', `/records/notices/${n1.record.id}/restore`, sec.token)).archived === false);
  ok('audit trail readable by secretary', (await call('GET', '/audit', sec.token)).audit.length > 10);
  ok('audit trail not readable by member', (await call('GET', '/audit', mem.token)).status === 403);
} catch (e) { fail++; console.log('ERROR', e); }

srv.kill();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
