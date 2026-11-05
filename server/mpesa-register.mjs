// Tells Safaricom (Daraja) where to send a notice for every payment to the church Pay Bill.
// Run this ONCE after the server is online (and again only if the address changes).
//
//   MPESA_ENV=sandbox            sandbox or production
//   MPESA_CONSUMER_KEY=...       from your app on the Daraja portal
//   MPESA_CONSUMER_SECRET=...
//   MPESA_SHORTCODE=600000       your Pay Bill number
//   PUBLIC_URL=https://api.yourchurch.org
//   MPESA_CALLBACK_SECRET=...    the same 64-character value that is in the server's .env
//   node mpesa-register.mjs [--dry-run]
//
// Optional overrides if Safaricom changes its addresses: MPESA_BASE_URL, MPESA_OAUTH_PATH, MPESA_REGISTER_PATH.
// Safaricom's rules for the notice addresses (checked below before anything is sent): production must use https, and the
// address must not contain words such as mpesa, safaricom, exe, exec, cmd, sql or query, and must not be a tunnel like ngrok.
const env = (k, d = '') => process.env[k] ?? d;
const dry = process.argv.includes('--dry-run');
const fail = (m) => { console.error('ERROR: ' + m); process.exit(1); };

const mode = env('MPESA_ENV', 'sandbox');
if (!['sandbox', 'production'].includes(mode)) fail('MPESA_ENV must be sandbox or production.');
const base = env('MPESA_BASE_URL') || (mode === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
const oauthPath = env('MPESA_OAUTH_PATH', '/oauth/v1/generate?grant_type=client_credentials');
// Safaricom documents the sandbox path below. For production the newer "v2" path is used by default; if registration is
// refused, confirm the exact path in the Daraja portal documentation and set MPESA_REGISTER_PATH.
const registerPath = env('MPESA_REGISTER_PATH', mode === 'production' ? '/mpesa/c2b/v2/registerurl' : '/mpesa/c2b/v1/registerurl');

const key = env('MPESA_CONSUMER_KEY'), secret = env('MPESA_CONSUMER_SECRET'), shortcode = env('MPESA_SHORTCODE');
const publicUrl = env('PUBLIC_URL').replace(/\/+$/, ''), hookSecret = env('MPESA_CALLBACK_SECRET');
if (!key || !secret) fail('Set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET.');
if (!/^\d{5,7}$/.test(shortcode)) fail('MPESA_SHORTCODE must be your Pay Bill number (5 to 7 digits).');
if (!publicUrl) fail('Set PUBLIC_URL to your server address, for example https://api.yourchurch.org');
if (!/^[0-9a-f]{32,}$/.test(hookSecret)) fail('MPESA_CALLBACK_SECRET must be at least 32 characters of 0-9 and a-f (make one with: openssl rand -hex 32).');
if (mode === 'production' && !publicUrl.startsWith('https://')) fail('In production Safaricom only accepts https addresses.');

const confirmationUrl = `${publicUrl}/hooks/c2b/${hookSecret}/confirmation`;
const validationUrl = `${publicUrl}/hooks/c2b/${hookSecret}/validation`;
if (/m-?pesa|safaricom|exe|exec|cmd|sql|query/i.test(publicUrl)) fail('Safaricom refuses addresses containing words like mpesa, safaricom, exe, cmd, sql or query. Use a different domain name for the server.');
if (/ngrok|mockbin|requestbin|localtunnel/i.test(publicUrl)) fail('Safaricom does not accept tunnel or request-testing addresses.');

const body = { ShortCode: shortcode, ResponseType: 'Completed', ConfirmationURL: confirmationUrl, ValidationURL: validationUrl };
console.log(`Registering with ${base}${registerPath}\n  Pay Bill: ${shortcode}\n  Confirmation address: ${publicUrl}/hooks/c2b/<secret>/confirmation`);
if (dry) { console.log('Dry run: nothing was sent.'); process.exit(0); }

try {
  const t = await fetch(base + oauthPath, { headers: { Authorization: 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') } });
  if (!t.ok) fail(`Safaricom refused the consumer key/secret (${t.status}).`);
  const { access_token: token } = await t.json();
  if (!token) fail('Safaricom did not return an access token.');
  const r = await fetch(base + registerPath, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {}
  console.log('Safaricom answered:', r.status, text.slice(0, 500));
  const good = r.ok && (String(j.ResponseCode) === '0' || /success/i.test(String(j.ResponseDescription || '')));
  if (!good) fail('Registration was not accepted. Read the answer above. If it says the URLs are already registered, ask Safaricom/Daraja support to clear the old ones.');
  console.log('Done. Make one small test payment to your Pay Bill and check it appears under "Unclaimed M-Pesa payments" in the app.');
} catch (e) { fail('Could not reach Safaricom: ' + e.message); }
