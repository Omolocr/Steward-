// Checks that a running Church Connect server is set up safely. Safe to run any time: it changes nothing.
//
//   node smoke-test.mjs https://api.yourchurch.org
//   node smoke-test.mjs https://api.yourchurch.org --phone 0712345678      (also tests a real SMS login code)
//   node smoke-test.mjs https://api.yourchurch.org --mpesa-secret <MPESA_CALLBACK_SECRET>   (also tests the M-Pesa address)
//
// --phone sends ONE real SMS to that number, then asks you to type the code. The number must already have an account.
import tls from 'node:tls';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const base = (args.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
if (!base) { console.error('Usage: node smoke-test.mjs https://api.yourchurch.org [--phone 07XXXXXXXX] [--mpesa-secret ...]'); process.exit(2); }
const url = new URL(base);
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);

let fails = 0, warns = 0;
const out = (tag, msg, fix) => { console.log(`${tag}  ${msg}`); if (fix) console.log(`      → ${fix}`); };
const pass = (m) => out('PASS', m);
const info = (m) => out('INFO', m);
const warn = (m, fix) => { warns++; out('WARN', m, fix); };
const fail = (m, fix) => { fails++; out('FAIL', m, fix); };

async function req(method, p, { token, body, headers = {} } = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    return { status: r.status, headers: r.headers, json: await r.json().catch(() => ({})), ms: Date.now() - t0 };
  } catch (e) { return { status: 0, error: e.cause?.code || e.message, ms: Date.now() - t0 }; }
}

console.log(`Checking ${base}\n`);

// 1. Reachable and healthy
const h = await req('GET', '/health');
if (h.status === 0) {
  fail(`Cannot reach the server (${h.error}).`, /ENOTFOUND/.test(h.error) ? 'The domain does not point to the server yet. Check the DNS "A" record.' : /CERT|SSL|TLS/i.test(h.error) ? 'The HTTPS certificate is not valid yet. Check: docker compose logs caddy' : 'Check that the containers are running (docker compose ps) and that ports 80 and 443 are open.');
  console.log('\nStopping: nothing else can be checked.'); process.exit(1);
}
h.status === 200 && h.json.ok ? pass(`Server is running and healthy (${h.ms} ms)`) : fail(`Health check answered ${h.status}.`, 'Run: docker compose logs --tail 100 app');
if (h.status === 200 && h.json && h.json.persistent === false) fail('Trial mode: the server keeps its data on a disk that is lost at every update.', 'Do not use real church data. For real use, host it on a persistent disk and set PERSISTENT_STORAGE=yes (deploy/CHAJIO.md).');
if (h.ms > 3000) warn(`The server is slow to answer (${h.ms} ms).`, 'A busier or larger server may help.');

// 2. HTTPS and certificate
if (url.protocol === 'https:') {
  pass('Address uses HTTPS');
  await new Promise((resolve) => {
    const s = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname }, () => {
      const days = Math.floor((new Date(s.getPeerCertificate().valid_to) - Date.now()) / 864e5);
      days >= 14 ? pass(`HTTPS certificate is valid for ${days} more days (renews automatically)`) : warn(`HTTPS certificate expires in ${days} days.`, 'Caddy should renew it by itself. Check: docker compose logs caddy');
      s.end(); resolve();
    });
    s.on('error', () => resolve());
  });
} else if (!isLocal) fail('Address uses plain http. Passwords and codes would travel unprotected.', 'Use the https:// address.');
else info('Local test address (no HTTPS needed)');

// 3. What the server says is switched on
const f = h.json || {};
f.sms ? pass('SMS is set up') : fail('SMS is not set up: login codes cannot be sent.', 'Set SMS_PROVIDER, AT_USERNAME and AT_API_KEY in .env, then: docker compose up -d');
f.ai ? pass('Sermon summaries are set up') : warn('Sermon summaries are not set up.', 'Set ANTHROPIC_API_KEY (and OPENAI_API_KEY for recordings) in .env if you want them.');
info(f.mpesa ? 'Automatic M-Pesa checking is ON' : 'Automatic M-Pesa checking is OFF (the Treasurer confirms by hand)');

// 4. Safety rules
const del = await req('DELETE', '/records/payments/test');
del.status === 405 ? pass('Deleting is refused (archive-only)') : fail(`A delete request was answered ${del.status}, not 405.`, 'This should never happen. Do not use the server until it is fixed.');
const me = await req('GET', '/me');
me.status === 401 ? pass('Private pages require sign-in') : fail(`/me answered ${me.status} without signing in.`, 'Check TOKEN_SECRET and the server logs.');
const rec = await req('GET', '/records/payments');
rec.status === 401 ? pass('Payment records require sign-in') : fail(`Payment records answered ${rec.status} without signing in.`);
const up = await req('POST', '/sermons/jobs', { headers: { 'Content-Type': 'audio/mp4' } });
up.status === 401 ? pass('Sermon uploads require sign-in') : fail(`Sermon upload answered ${up.status} without signing in.`);
const cors = await req('GET', '/health', { headers: { Origin: 'https://evil.example' } });
const acao = cors.headers && cors.headers.get('access-control-allow-origin');
!acao ? pass('Other websites cannot call the server from a browser') : acao === '*' ? (isLocal ? info('Test mode allows any website (normal on a local test server)') : fail('Any website is allowed to call the server.', 'The server is probably running in test mode: it must run with NODE_ENV=production (the Docker setup does this).')) : pass(`Only ${acao} may call the server from a browser`);

// 5. M-Pesa address protected
if (f.mpesa) {
  const wrong = await req('POST', '/hooks/c2b/' + crypto.randomBytes(32).toString('hex') + '/confirmation', { body: {} });
  wrong.status === 404 ? pass('The M-Pesa address cannot be guessed (wrong secret → 404)') : fail(`The M-Pesa address answered ${wrong.status} for a wrong secret.`, 'It must answer 404. Check MPESA_CALLBACK_SECRET.');
  const secret = opt('--mpesa-secret');
  if (secret) {
    const v = await req('POST', `/hooks/c2b/${secret}/validation`, { body: {} });
    v.status === 200 && String(v.json.ResultCode) === '0' ? pass('The M-Pesa address Safaricom calls works with your secret') : fail(`The M-Pesa validation address answered ${v.status}.`, 'The secret you gave is not the one in .env, or the server has not been restarted since you changed it.');
  } else info('Tip: add --mpesa-secret <MPESA_CALLBACK_SECRET> to test the address Safaricom calls.');
}

// 6. Optional: a real login by SMS
const phone = opt('--phone');
if (phone) {
  console.log(`\nSending ONE SMS login code to ${phone}…`);
  const o = await req('POST', '/auth/request-otp', { body: { phone } });
  if (o.status !== 200) fail(`Could not send the code (${o.status}): ${o.json.error || o.error}`, 'Check your Africa\'s Talking balance, username and key: docker compose logs --tail 50 app');
  else if (o.json.devCode) fail('The server is in TEST MODE: it put the login code in its reply, so anyone could sign in as anyone.', 'It must run with NODE_ENV=production (the Docker setup does this). Do not open the app to members until this passes.');
  else {
    pass('The server accepted the request and sent an SMS');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const code = opt('--code') || (await rl.question('Type the 6-digit code you received by SMS (or press Enter if none arrived): ')).trim();
    rl.close();
    if (!code) fail('No SMS arrived.', 'Check the Africa\'s Talking balance and sender name; in sandbox mode messages only appear in their simulator, not on real phones.');
    else {
      const v = await req('POST', '/auth/verify', { body: { phone, code } });
      if (v.status === 200) {
        const m = await req('GET', '/me', { token: v.json.token });
        pass(`Signed in as ${m.json.user.name} (${m.json.user.role})`);
        (await req('GET', '/records/notices', { token: v.json.token })).status === 200 ? pass('Church data can be read after signing in') : fail('Signed in, but the notice board could not be read.');
      } else if (v.status === 400 && /profile/i.test(v.json.error || '')) info('The code was correct, but this number has no account yet. Sign up from the app first, then run this again.');
      else fail(`Sign-in failed (${v.status}): ${v.json.error}`);
    }
  }
}

console.log(`\n${fails ? 'NOT READY' : 'LOOKS GOOD'}: ${fails} problem(s), ${warns} warning(s).`);
process.exit(fails ? 1 : 0);
