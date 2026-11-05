// First-run guide: seen once per role, kept on the server. Run: node --no-warnings test-guide.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'church-gd-'));
const PORT = 18170;
let out = '';
const srv = spawn('node', ['--no-warnings', new URL('./server.mjs', import.meta.url).pathname], {
  env: { ...process.env, PORT, DB_FILE: path.join(dir, 't.db'), DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'test', BOOTSTRAP: '0711000001:secretary,0711000002:pastor', PUSH_PROVIDER: 'off' },
});
srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));
await new Promise((r) => setTimeout(r, 1000));
const base = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const call = async (method, p, token, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
async function login(phone, profile) {
  const o = await call('POST', '/auth/request-otp', null, { phone });
  const v = await call('POST', '/auth/verify', null, { phone, code: o.devCode, profile });
  return { token: v.token, user: v.user };
}
const prof = (name, extra = {}) => ({ name, idNumber: '3' + Math.floor(Math.random() * 1e7), church: 'Test SDA Church', ...extra });

try {
  const m = await login('0722000001', prof('Grace Wanjiku'));
  ok('a new person has not seen any guide', (m.user.guideSeen ?? '') === '', JSON.stringify(m.user.guideSeen));
  const bad = await call('POST', '/me/guide-seen', m.token, { role: 'Bad Role!' });
  ok('a malformed role is refused', bad.status === 400);
  const noTok = await call('POST', '/me/guide-seen', null, { role: 'member' });
  ok('signing in is required', noTok.status === 401);
  const s = await call('POST', '/me/guide-seen', m.token, { role: 'member' });
  ok('seeing the member guide is remembered', s.status === 200 && s.guideSeen === 'member');
  const me = await call('GET', '/me', m.token);
  ok('and comes back with the profile on any phone', me.user.guideSeen === 'member', JSON.stringify(me.user));
  // a leader who gets verified sees the leader guide once more: the app compares guideSeen with the role
  const p = await login('0711000002', prof('Pastor Moses', { requestedRole: 'pastor' }));
  ok('a pre-approved Pastor starts with the guide unseen', (p.user.guideSeen ?? '') === '' && p.user.role === 'pastor');
  await call('POST', '/me/guide-seen', p.token, { role: 'pastor' });
  const p2 = await call('GET', '/me', p.token);
  ok('Pastor guide remembered separately', p2.user.guideSeen === 'pastor');
  const m2 = await call('GET', '/me', m.token);
  ok('one person\'s guide state does not affect another', m2.user.guideSeen === 'member');
  const r = await call('DELETE', '/me/guide-seen', m.token);
  ok('nothing deletable', r.status === 405 || r.status === 404);
} finally {
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
