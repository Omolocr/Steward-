// Tests automatic M-Pesa verification against a FAKE Safaricom. Run: node --no-warnings test-mpesa.mjs
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = (f) => new URL(f, import.meta.url).pathname;
const SECRET = 'a1'.repeat(32); // 64 hex characters
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanEnv = { ...process.env }; for (const k of Object.keys(cleanEnv)) if (/^(SMS_|AT_|TOKEN_|BOOTSTRAP|NODE_ENV|DATA_DIR|DB_FILE|ANTHROPIC_|OPENAI_|TRANSCRIBE_|MPESA_|PUBLIC_URL)/.test(k)) delete cleanEnv[k];

// NOTE: must not block this process: the fake Safaricom below runs inside it and has to answer the script's requests.
const runNode = (cmd, args, opts) => new Promise((resolve) => {
  const c = spawn(cmd, args, { env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '';
  c.stdout.on('data', (d) => { stdout += d; }); c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => resolve({ status, stdout, stderr }));
});
// ---- fake Safaricom (OAuth + register URL)
const seen = [];
const daraja = http.createServer(async (req, res) => {
  const b = []; for await (const c of req) b.push(c); const raw = Buffer.concat(b).toString();
  seen.push({ url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url.startsWith('/oauth/v1/generate')) return res.end(JSON.stringify(req.headers.authorization === 'Basic ' + Buffer.from('ck:cs').toString('base64') ? { access_token: 'tok123', expires_in: '3599' } : {}));
  if (req.url.endsWith('/registerurl')) return res.end(JSON.stringify(req.headers.authorization === 'Bearer tok123' ? { ResponseCode: '0', ResponseDescription: 'Success' } : { ResponseCode: '1' }));
  res.end('{}');
});
await new Promise((r) => daraja.listen(18096, r));

function start(port, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-mp-'));
  const p = spawn('node', ['--no-warnings', here('./server.mjs')], { env: { ...cleanEnv, PORT: port, DATA_DIR: dir, DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'test', BOOTSTRAP: '0711000001:secretary,0711000002:pastor', MPESA_CALLBACK_SECRET: SECRET, MPESA_SHORTCODE: '600966', ...extra }, stdio: 'ignore' });
  return { p, dir, base: `http://localhost:${port}` };
}
const mk = (S) => {
  const call = async (method, p, token, body) => { const r = await fetch(S.base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const login = async (phone, profile) => { const o = await call('POST', '/auth/request-otp', null, { phone }); const v = await call('POST', '/auth/verify', null, { phone, code: o.devCode, profile }); return { token: v.token, user: v.user }; };
  const hook = (kind, payload, secret = SECRET) => call('POST', `/hooks/c2b/${secret}/${kind}`, null, payload);
  return { call, login, hook };
};
const tx = (id, amount, over = {}) => ({ TransactionType: 'Pay Bill', TransID: id, TransTime: '20261020093015', TransAmount: String(amount) + '.00', BusinessShortCode: '600966', BillRefNumber: 'Nanyuki SDA', InvoiceNumber: '', OrgAccountBalance: '1000.00', ThirdPartyTransID: '', MSISDN: '2547 ***** 126', FirstName: 'GRACE', MiddleName: '', LastName: 'WANJIKU', ...over });
const split = [{ category: 'Tithe', percent: 10 }, { category: 'Offering', percent: 90 }];
const pay = (code, amount, over = {}) => ({ mpesaCode: code, mpesaName: 'GRACE WANJIKU', purpose: 'Tithe and offering', amount, allocations: split, ...over });

const A = start(18082), B = start(18083, { MPESA_AUTO_RECEIPT: '1' }), P = start(18084);
await sleep(1500);
try {
  const a = mk(A);
  const sec = await a.login('0711000001', { name: 'Ruth Secretary', idNumber: '1', church: 'Test SDA' });
  const pas = await a.login('0711000002', { name: 'Pastor John', idNumber: '2', church: 'Test SDA' });
  const tre = await a.login('0733000002', { name: 'Daniel Treasurer', idNumber: '3', church: 'Test SDA', role: 'treasurer' });
  await a.call('POST', `/users/${tre.user.id}/role-decision`, sec.token, { approve: true });
  const mem = await a.login('0722000001', { name: 'Grace Member', idNumber: '4', church: 'Test SDA' });
  const mem2 = await a.login('0722000002', { name: 'Peter Member', idNumber: '5', church: 'Test SDA' });

  // ---- the callback addresses
  ok('health shows M-Pesa checking is on', (await (await fetch(A.base + '/health')).json()).mpesa === true);
  const bad = await a.hook('confirmation', tx('SGH7K2L9QX', 1000), 'b2'.repeat(32));
  ok('wrong secret in the address looks like a missing page (404)', bad.status === 404 && !bad.ResultCode);
  ok('validation address accepts (Safaricom format)', (await a.hook('validation', tx('SGH7K2L9QX', 1000))).ResultCode === '0');
  ok('malformed payment notice rejected', (await a.hook('confirmation', { TransID: 'x' })).status === 400);
  ok('negative amount rejected', (await a.hook('confirmation', tx('NEG7K2L9QX', -5))).status === 400);

  // ---- member reports first, Safaricom's notice arrives after
  const p1 = await a.call('POST', '/records/payments', mem.token, pay('SGH7K2L9QX', 1000));
  ok('before the notice arrives the payment is "waiting" for M-Pesa', p1.record?.verification?.state === 'waiting', JSON.stringify(p1));
  const c1 = await a.hook('confirmation', tx('SGH7K2L9QX', 1000));
  ok('Safaricom gets the accepted answer', c1.ResultCode === '0' && c1.ResultDesc === 'Accepted');
  let list = (await a.call('GET', '/records/payments', tre.token)).records;
  const v1 = list.find((x) => x.id === p1.record.id).verification;
  ok('when the notice arrives the payment becomes VERIFIED with the M-Pesa name and Kenyan time', v1.state === 'verified' && v1.mpesaAmount === 1000 && v1.mpesaName === 'GRACE WANJIKU' && v1.mpesaTime === '2026-10-20T09:30:15+03:00', JSON.stringify(v1));
  const r1 = await a.call('POST', `/payments/${p1.record.id}/receive`, tre.token, {});
  ok('treasurer confirms a verified payment with one tap (no warning)', r1.receipt?.receiptNo === 'RCT-00001');

  // ---- Safaricom's notice first, member reports after
  await a.hook('confirmation', tx('QWE7K2L9QX', 500, { FirstName: 'PETER' }));
  const p2 = await a.call('POST', '/records/payments', mem2.token, pay('QWE7K2L9QX', 500, { mpesaName: 'PETER' }));
  ok('notice already there: verified immediately', p2.record?.verification?.state === 'verified');

  // ---- amount mismatch
  await a.hook('confirmation', tx('MIS7K2L9QX', 200));
  const p3 = await a.call('POST', '/records/payments', mem.token, pay('MIS7K2L9QX', 2000));
  ok('amount differs from M-Pesa: flagged amount_mismatch with the real amount', p3.record?.verification?.state === 'amount_mismatch' && p3.record.verification.mpesaAmount === 200);
  const warn = await a.call('POST', `/payments/${p3.record.id}/receive`, tre.token, {});
  ok('treasurer is warned (412) and nothing is receipted', warn.status === 412 && /M-Pesa shows KSh 200/.test(warn.error), JSON.stringify(warn));
  ok('no receipt was created by the warned attempt', (await a.call('GET', '/records/receipts', tre.token)).records.length === 1);
  const forced = await a.call('POST', `/payments/${p3.record.id}/receive`, tre.token, { confirmAnyway: true });
  ok('treasurer can still confirm after checking (confirmAnyway)', !!forced.receipt);
  const audit = (await a.call('GET', '/audit', sec.token)).audit;
  ok('the override is written to the audit trail', audit.some((x) => /without a matching M-Pesa record \(amount_mismatch\)/.test(x.detail || '')));

  // ---- not on M-Pesa at all
  const p4 = await a.call('POST', '/records/payments', mem2.token, pay('FAK7K2L9QX', 800, { mpesaName: 'PETER' }));
  ok('made-up code: waiting, and receipt is refused without an explicit override', p4.record.verification.state === 'waiting' && (await a.call('POST', `/payments/${p4.record.id}/receive`, tre.token, {})).status === 412);

  // ---- cannot fake the verification from the phone
  const forge = await a.call('POST', '/records/payments', mem.token, pay('FRG7K2L9QX', 900, { verification: { state: 'verified', mpesaAmount: 900 }, status: 'received', receiptNo: 'RCT-99999', receivedBy: 'Daniel', id: 'x' }));
  ok('fake "verified", "received" and receipt number sent by a phone are ignored', forge.record?.status === 'pending' && forge.record.verification.state === 'waiting' && !forge.record.receiptNo && !forge.record.receivedBy, JSON.stringify(forge.record));

  // ---- repeats and unclaimed money
  const r2a = await a.hook('confirmation', tx('UNC7K2L9QX', 3000, { FirstName: 'JOHN', LastName: 'OTIENO' }));
  const r2b = await a.hook('confirmation', tx('UNC7K2L9QX', 3000, { FirstName: 'JOHN', LastName: 'OTIENO' }));
  ok('a repeated notice from Safaricom is answered the same way', r2a.ResultCode === '0' && r2b.ResultCode === '0');
  const unc = await a.call('GET', '/finance/unclaimed', tre.token);
  ok('unclaimed list shows the unreported payment once, with the payer name', unc.transactions.filter((t) => t.code === 'UNC7K2L9QX').length === 1 && unc.transactions[0].name === 'JOHN OTIENO' && unc.transactions[0].amount === 3000);
  ok('payments already claimed by a member are not in the unclaimed list', !unc.transactions.some((t) => ['SGH7K2L9QX', 'QWE7K2L9QX', 'MIS7K2L9QX'].includes(t.code)));
  ok('pastor can see unclaimed payments; members cannot', (await a.call('GET', '/finance/unclaimed', pas.token)).transactions.length === 1 && (await a.call('GET', '/finance/unclaimed', mem.token)).status === 403);
  await a.hook('confirmation', tx('OTH7K2L9QX', 100, { BusinessShortCode: '999999' }));
  ok("a payment to a different Pay Bill is ignored", !(await a.call('GET', '/finance/unclaimed', tre.token)).transactions.some((t) => t.code === 'OTH7K2L9QX'));

  // ---- archive-only for M-Pesa records
  const dbh = new DatabaseSync(path.join(A.dir, 'church.db')); let blocked = false; try { dbh.exec('DELETE FROM mpesa_tx'); } catch { blocked = true; } dbh.close();
  ok('M-Pesa records cannot be deleted from the database', blocked);

  // ---- automatic receipt mode
  const b = mk(B);
  await b.login('0711000001', { name: 'Ruth Secretary', idNumber: '1', church: 'Test SDA' });
  const bm = await b.login('0722000001', { name: 'Grace Member', idNumber: '4', church: 'Test SDA' });
  await b.hook('confirmation', tx('AUT7K2L9QX', 1000));
  const q1 = await b.call('POST', '/records/payments', bm.token, pay('AUT7K2L9QX', 1000));
  ok('auto mode, notice first: receipt issued with no Treasurer tap', q1.record?.status === 'received' && q1.record.receivedBy === 'M-Pesa (automatic)' && /^RCT-/.test(q1.record.receiptNo), JSON.stringify(q1.record));
  const q2 = await b.call('POST', '/records/payments', bm.token, pay('AU27K2L9QX', 700));
  ok('auto mode, member first: stays pending until Safaricom confirms', q2.record.status === 'pending');
  await b.hook('confirmation', tx('AU27K2L9QX', 700));
  const mine = (await b.call('GET', '/records/receipts', bm.token)).records;
  ok('then the receipt is issued automatically and the member can see it', mine.length === 2 && mine.some((r) => r.mpesaCode === 'AU27K2L9QX' && /Confirmed automatically/.test(r.text) && r.issuedBy === 'M-Pesa (automatic)'));
  await b.hook('confirmation', tx('AU37K2L9QX', 50));
  const q3 = await b.call('POST', '/records/payments', bm.token, pay('AU37K2L9QX', 5000));
  ok('auto mode never receipts a payment whose amount differs', q3.record.status === 'pending' && q3.record.verification.state === 'amount_mismatch');
  ok('automatic receipt numbers keep counting without gaps', mine.map((r) => r.receiptNo).sort().join() === 'RCT-00001,RCT-00002');

  // ---- registration script against the fake Safaricom
  const reg = (extra) => runNode('node', ['--no-warnings', here('./mpesa-register.mjs')], { env: { ...cleanEnv, MPESA_ENV: 'sandbox', MPESA_BASE_URL: 'http://localhost:18096', MPESA_CONSUMER_KEY: 'ck', MPESA_CONSUMER_SECRET: 'cs', MPESA_SHORTCODE: '600966', PUBLIC_URL: 'https://api.stmarys.org', MPESA_CALLBACK_SECRET: SECRET, ...extra }, encoding: 'utf8' });
  let g = await reg({});
  const post = seen.find((s) => s.url.endsWith('/registerurl'));
  ok('registration succeeds and sends the Pay Bill, both addresses and "Completed"', g.status === 0 && post?.body.ShortCode === '600966' && post.body.ResponseType === 'Completed' && post.body.ConfirmationURL === `https://api.stmarys.org/hooks/c2b/${SECRET}/confirmation` && post.body.ValidationURL.endsWith('/validation') && post.auth === 'Bearer tok123', g.stdout + g.stderr);
  ok('registration never prints the secret address', !g.stdout.includes(SECRET) && !g.stderr.includes(SECRET));
  ok('registration refuses wrong consumer key', (await reg({ MPESA_CONSUMER_KEY: 'nope' })).status === 1);
  ok('registration refuses http in production', (await reg({ MPESA_ENV: 'production', PUBLIC_URL: 'http://api.stmarys.org' })).status === 1);
  ok('registration refuses addresses containing forbidden words', (await reg({ PUBLIC_URL: 'https://mpesa.stmarys.org' })).status === 1 && (await reg({ PUBLIC_URL: 'https://abc.ngrok.io' })).status === 1);
  ok('registration refuses a weak callback secret', (await reg({ MPESA_CALLBACK_SECRET: 'short' })).status === 1);
  const before = seen.length; g = await reg({ '--x': '' }); const dry = await runNode('node', ['--no-warnings', here('./mpesa-register.mjs'), '--dry-run'], { env: { ...cleanEnv, MPESA_BASE_URL: 'http://localhost:18096', MPESA_CONSUMER_KEY: 'ck', MPESA_CONSUMER_SECRET: 'cs', MPESA_SHORTCODE: '600966', PUBLIC_URL: 'https://api.stmarys.org', MPESA_CALLBACK_SECRET: SECRET }, encoding: 'utf8' });
  ok('dry run sends nothing', dry.status === 0 && /nothing was sent/.test(dry.stdout) && seen.length === before + 2);

  // ---- production safety for the secret
  const prod = spawnSync('node', ['--no-warnings', here('./server.mjs')], { env: { ...cleanEnv, NODE_ENV: 'production', PERSISTENT_STORAGE: 'yes', DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'africastalking', AT_USERNAME: 'u', AT_API_KEY: 'k', MPESA_CALLBACK_SECRET: 'tooshort', DATA_DIR: P.dir, PORT: 18085 }, encoding: 'utf8', timeout: 8000 });
  ok('production refuses a short M-Pesa callback secret', prod.status === 1 && /MPESA_CALLBACK_SECRET/.test(prod.stderr), prod.stderr);

  // ---- when M-Pesa checking is OFF the old behaviour is unchanged
  const off = start(18086, { MPESA_CALLBACK_SECRET: '' }); await sleep(1200); const o = mk(off);
  const osec = await o.login('0711000001', { name: 'Ruth', idNumber: '1', church: 'T' });
  const otre = await o.login('0733000002', { name: 'Dan', idNumber: '3', church: 'T', role: 'treasurer' });
  await o.call('POST', `/users/${otre.user.id}/role-decision`, osec.token, { approve: true });
  const om = await o.login('0722000001', { name: 'Grace', idNumber: '4', church: 'T' });
  const op = await o.call('POST', '/records/payments', om.token, pay('OFF7K2L9QX', 100));
  ok('M-Pesa checking off: no verification field and no extra warning', op.record.verification === undefined && !!(await o.call('POST', `/payments/${op.record.id}/receive`, otre.token, {})).receipt);
  ok('M-Pesa checking off: callback address does not exist', (await o.hook('confirmation', tx('OFF7K2L9QX', 100))).status === 404);
  off.p.kill();
} catch (e) { fail++; console.log('ERROR', e); }

for (const s of [A, B, P]) { s.p.kill(); }
daraja.close();
await sleep(300);
for (const s of [A, B, P]) fs.rmSync(s.dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
