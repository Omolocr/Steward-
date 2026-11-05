// Tests the smoke-test tool itself against a test-mode server, a production-mode server, and a dead address.
// Run: node --no-warnings test-smoke.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = (f) => new URL(f, import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '\n' + String(x).slice(-900))); };
const clean = { ...process.env }; for (const k of Object.keys(clean)) if (/^(SMS_|AT_|TOKEN_|BOOTSTRAP|NODE_ENV|DATA_DIR|DB_FILE|ANTHROPIC_|OPENAI_|TRANSCRIBE_|MPESA_)/.test(k)) delete clean[k];
const SECRET = 'b2'.repeat(32);

const sms = [];
const fake = http.createServer(async (req, res) => { const b = []; for await (const c of req) b.push(c); const f = new URLSearchParams(Buffer.concat(b).toString()); sms.push(f.get('message')); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101 }] } })); });
await new Promise((r) => fake.listen(18097, r));

const server = (port, env) => spawn('node', ['--no-warnings', here('./server.mjs')], { env: { ...clean, PORT: port, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'church-sm-')), ...env }, stdio: 'ignore' });
// The smoke tool must run as a separate process we do not block, so the servers above can answer it.
const smoke = (args, onSpawn) => new Promise((resolve) => {
  const c = spawn('node', ['--no-warnings', here('./smoke-test.mjs'), ...args], { env: clean, stdio: ['pipe', 'pipe', 'pipe'] }); let o = '';
  c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; });
  c.on('close', (status) => resolve({ status, out: o })); onSpawn && onSpawn(c, () => o);
});

const prod = server(18120, { NODE_ENV: 'production', PERSISTENT_STORAGE: 'yes', DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'africastalking', AT_USERNAME: 'sandbox', AT_API_KEY: 'k', AT_BASE_URL: 'http://localhost:18097', MPESA_CALLBACK_SECRET: SECRET, ANTHROPIC_API_KEY: 'a', TRUST_PROXY: '1', BOOTSTRAP: '0711000001:secretary' });
const dev = server(18121, { DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'dev', BOOTSTRAP: '0711000001:secretary' });
await sleep(1500);

try {
  // account for the real-login check
  const reg = async (port, withSms) => {
    const o = await (await fetch(`http://localhost:${port}/auth/request-otp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '0711000001' }) })).json();
    const code = o.devCode || sms.at(-1).match(/code is (\d{6})/)[1];
    await fetch(`http://localhost:${port}/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '0711000001', code, profile: { name: 'Ruth Secretary', idNumber: '1', church: 'T' } }) });
  };
  await reg(18120); await reg(18121);

  // 1. production server, everything on, real login via SMS (code typed into the tool like a person would)
  let sent = false;
  const p = await smoke(['http://localhost:18120', '--phone', '0711000001', '--mpesa-secret', SECRET], (c, get) => {
    const t = setInterval(() => { if (!sent && /Type the 6-digit code/.test(get())) { sent = true; c.stdin.write(sms.at(-1).match(/code is (\d{6})/)[1] + '\n'); clearInterval(t); } }, 100);
  });
  ok('production server: ends with LOOKS GOOD and exit code 0', p.status === 0 && /LOOKS GOOD: 0 problem/.test(p.out), p.out);
  ok('checks delete refusal, sign-in walls, CORS, M-Pesa secret and the real SMS login', ['Deleting is refused', 'Private pages require sign-in', 'Sermon uploads require sign-in', 'cannot call the server', 'cannot be guessed', 'works with your secret', 'Signed in as Ruth Secretary'].every((s) => p.out.includes(s)), p.out);

  // 2. test-mode server must be flagged when a real login is tried
  const d = await smoke(['http://localhost:18121', '--phone', '0711000001']);
  ok('test-mode server: login code in the reply is flagged as FAIL', d.status === 1 && /TEST MODE/.test(d.out) && /NOT READY/.test(d.out), d.out);

  // 3. wrong M-Pesa secret
  const w = await smoke(['http://localhost:18120', '--mpesa-secret', 'c3'.repeat(32)]);
  ok('wrong M-Pesa secret is reported', w.status === 1 && /not the one in \.env/.test(w.out), w.out);

  // 4. nothing there
  const x = await smoke(['http://localhost:18199']);
  ok('unreachable server: clear message and exit code 1', x.status === 1 && /Cannot reach the server/.test(x.out), x.out);

  // 5. plain http on a real-looking address is refused as unsafe (no connection needed)
  const hx = await smoke(['http://192.0.2.1:9', '--phone', '0711000001']);
  ok('unreachable plain-http address stops early without sending SMS', hx.status === 1 && !/Sending ONE SMS/.test(hx.out), hx.out);

  // 6. no usage
  const u = await smoke([]);
  ok('no address gives usage help', u.status === 2 && /Usage/.test(u.out));
} catch (e) { fail++; console.log('ERROR', e); }

prod.kill(); dev.kill(); fake.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
