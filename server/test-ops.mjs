// Operations tests: production safety checks, backup + restore, graceful shutdown.
// Run: node --no-warnings test-ops.mjs
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = (f) => new URL(f, import.meta.url).pathname;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'church-ops-'));
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanEnv = { ...process.env }; for (const k of Object.keys(cleanEnv)) if (/^(SMS_|AT_|TOKEN_|BOOTSTRAP|NODE_ENV|DATA_DIR|DB_FILE|ANTHROPIC_|OPENAI_|TRANSCRIBE_)/.test(k)) delete cleanEnv[k];
const startSrv = (env) => spawn('node', ['--no-warnings', here('./server.mjs')], { env: { ...cleanEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
const runSrv = (env) => spawnSync('node', ['--no-warnings', here('./server.mjs')], { env: { ...cleanEnv, ...env }, encoding: 'utf8', timeout: 8000 });

// ---- fake Africa's Talking so a production-mode server can start and send
const sms = [];
const fake = http.createServer(async (req, res) => {
  const b = []; for await (const c of req) b.push(c);
  const f = new URLSearchParams(Buffer.concat(b).toString()); sms.push({ to: f.get('to'), message: f.get('message') });
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode: 101, status: 'Success' }] } }));
});
await new Promise((r) => fake.listen(18095, r));
const PROD = { NODE_ENV: 'production', PERSISTENT_STORAGE: 'yes', DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'africastalking', AT_USERNAME: 'sandbox', AT_API_KEY: 'k', AT_BASE_URL: 'http://localhost:18095' };

try {
  // ---------------------------------------------------------------- production refuses unsafe settings
  let r = runSrv({ NODE_ENV: 'production', PERSISTENT_STORAGE: 'yes', DATA_DIR: tmp(), PORT: 18110 });
  ok('production without TOKEN_SECRET refuses to start', r.status === 1 && /TOKEN_SECRET/.test(r.stderr), r.stderr);
  r = runSrv({ NODE_ENV: 'production', PERSISTENT_STORAGE: 'yes', DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'short', DATA_DIR: tmp(), PORT: 18110 });
  ok('production with a short secret refuses to start', r.status === 1 && /TOKEN_SECRET/.test(r.stderr));
  r = runSrv({ NODE_ENV: 'production', PERSISTENT_STORAGE: 'yes', DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'x'.repeat(40), DATA_DIR: tmp(), PORT: 18110 });
  ok('production without SMS configured refuses to start', r.status === 1 && /SMS/.test(r.stderr));

  // ---------------------------------------------------------------- hosts that wipe the disk: refuse unless the operator says so
  const GOOD = { NODE_ENV: 'production', DEFAULT_CHURCH: 'Test SDA Church', TOKEN_SECRET: 'x'.repeat(40), SMS_PROVIDER: 'africastalking', AT_USERNAME: 'u', AT_API_KEY: 'k', PORT: 18112 };
  r = runSrv({ ...GOOD, DATA_DIR: tmp() });
  ok('production without PERSISTENT_STORAGE refuses to start and names the fix', r.status === 1 && /PERSISTENT_STORAGE=yes/.test(r.stderr) && /ALLOW_EPHEMERAL/.test(r.stderr), r.stderr);
  { const eph = startSrv({ ...GOOD, ALLOW_EPHEMERAL: 'yes', DATA_DIR: tmp() }); await new Promise((r2) => setTimeout(r2, 1500));
    const h = await fetch('http://localhost:18112/health').then((x) => x.json()).catch(() => null);
    ok('trial mode starts but /health says it is not persistent', h && h.ok === true && h.persistent === false, JSON.stringify(h));
    eph.kill(); }

  // ---------------------------------------------------------------- production runs; real data; backup; restore
  const data = tmp();
  let srv = startSrv({ ...PROD, DATA_DIR: data, PORT: 18111, BOOTSTRAP: '0711000001:secretary', TRUST_PROXY: '1' });
  await sleep(1200);
  const call = async (port, method, p, token, body) => { const r = await fetch(`http://localhost:${port}${p}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };
  const h = await call(18111, 'GET', '/health');
  ok('production server starts and /health is ok', h.ok === true && h.sms === true);
  const o = await call(18111, 'POST', '/auth/request-otp', null, { phone: '0711000001' });
  ok('production never reveals the login code in the response', o.sent === true && o.devCode === undefined);
  const code = sms.at(-1).message.match(/code is (\d{6})/)[1];
  const v = await call(18111, 'POST', '/auth/verify', null, { phone: '0711000001', code, profile: { name: 'Ruth Secretary', idNumber: '123' } });

  ok('login works with the SMS code', !!v.token && v.user.role === 'secretary');
  const m = await call(18111, 'POST', '/records/minutes', v.token, { kind: 'Church Board', title: 'September board', body: 'Important minutes' });
  ok('record saved', !!m.record);
  const cors = await fetch('http://localhost:18111/health', { headers: { Origin: 'https://evil.example' } });
  ok('production does not allow any website to call the API (no open CORS)', !cors.headers.get('access-control-allow-origin'));

  // backup while the server is running
  const bk = path.join(data, 'backups');
  let b = spawnSync('node', ['--no-warnings', here('./backup.mjs')], { env: { ...cleanEnv, DATA_DIR: data }, encoding: 'utf8' });
  const files = fs.existsSync(bk) ? fs.readdirSync(bk).filter((f) => f.startsWith('snapshot-')) : [];
  ok('backup succeeds while the server is running', b.status === 0 && files.length === 1 && /1 churches/.test(b.stdout) && /Backup OK/.test(b.stdout), b.stdout + b.stderr);
  ok('backup reports the record count', /1 records/.test(b.stdout), b.stdout);

  // restore into a brand-new folder, start a server on it, and confirm the data is there
  const restored = tmp(); fs.cpSync(path.join(bk, files[0]), restored, { recursive: true });
  const srv2 = startSrv({ ...PROD, DATA_DIR: restored, PORT: 18112 });
  await sleep(1200);
  const o2 = await call(18112, 'POST', '/auth/request-otp', null, { phone: '0711000001' });
  const code2 = sms.at(-1).message.match(/code is (\d{6})/)[1];
  const v2 = await call(18112, 'POST', '/auth/verify', null, { phone: '0711000001', code: code2 });
  const mins = await call(18112, 'GET', '/records/minutes', v2.token);
  ok('restored backup: same person can sign in and the minutes are there', o2.sent && mins.records?.length === 1 && mins.records[0].title === 'September board', JSON.stringify(mins));
  const del = new (await import('node:sqlite')).DatabaseSync(path.join(restored, fs.readdirSync(path.join(restored, 'churches'))[0] ? 'churches/' + fs.readdirSync(path.join(restored, 'churches'))[0] : ''));
  let blocked = false; try { del.exec('DELETE FROM records'); } catch { blocked = true; }
  del.close();
  ok('the delete-protection survives in the restored copy', blocked);
  srv2.kill();

  // restore.mjs: put a snapshot back over a live (changed) data folder; nothing is deleted
  {
    const mins2 = await call(18111, 'POST', '/records/minutes', v.token, { kind: 'Church Board', title: 'Written after the backup', body: 'x' });
    ok('a record was written after the backup', !!mins2.record);
    srv.kill(); await sleep(500);
    const snapDir = path.join(bk, files[0]);
    let r2 = spawnSync('node', ['--no-warnings', here('./restore.mjs')], { env: { ...cleanEnv, DATA_DIR: data }, encoding: 'utf8' });
    ok('restore without saying which backup refuses', r2.status === 1 && /Say which backup/.test(r2.stderr));
    r2 = spawnSync('node', ['--no-warnings', here('./restore.mjs'), path.join(data, 'nothing-here')], { env: { ...cleanEnv, DATA_DIR: data }, encoding: 'utf8' });
    ok('restore from something that is not a snapshot refuses and touches nothing', r2.status === 1 && fs.existsSync(path.join(data, 'platform.db')) && /not a backup snapshot/.test(r2.stderr));
    const bad = tmp(); fs.cpSync(snapDir, bad, { recursive: true }); fs.rmSync(path.join(bad, 'churches'), { recursive: true });
    r2 = spawnSync('node', ['--no-warnings', here('./restore.mjs'), bad], { env: { ...cleanEnv, DATA_DIR: data }, encoding: 'utf8' });
    ok('a snapshot missing a church database is refused before anything changes', r2.status === 1 && /missing the database/.test(r2.stderr) && fs.existsSync(path.join(data, 'platform.db')), r2.stderr);
    r2 = spawnSync('node', ['--no-warnings', here('./restore.mjs'), snapDir], { env: { ...cleanEnv, DATA_DIR: data }, encoding: 'utf8' });
    ok('restore succeeds and reports what it restored', r2.status === 0 && /Restore OK/.test(r2.stdout) && /1 churches, 1 records/.test(r2.stdout), r2.stdout + r2.stderr);
    const asides = fs.readdirSync(data).filter((f) => f.startsWith('before-restore-'));
    ok('the data that was there before is kept aside, not deleted', asides.length === 1 && fs.existsSync(path.join(data, asides[0], 'platform.db')) && fs.existsSync(path.join(data, asides[0], 'churches')));
    srv = startSrv({ ...PROD, DATA_DIR: data, PORT: 18111, BOOTSTRAP: '0711000001:secretary', TRUST_PROXY: '1' }); await sleep(1200);
    await call(18111, 'POST', '/auth/request-otp', null, { phone: '0711000001' });
    const c3 = sms.at(-1).message.match(/code is (\d{6})/)[1];
    const v3 = await call(18111, 'POST', '/auth/verify', null, { phone: '0711000001', code: c3 });
    const m3 = await call(18111, 'GET', '/records/minutes', v3.token);
    ok('after the restore the server shows the backed-up state (the later record is gone from view, but kept aside)', m3.records?.length === 1 && m3.records[0].title === 'September board', JSON.stringify(m3).slice(0, 200));
  }

  // a second backup, and pruning keeps only the newest snapshots
  await sleep(1100); // new backups get a new name
  for (let i = 0; i < 9; i++) fs.cpSync(path.join(bk, files[0]), path.join(bk, `snapshot-2020-01-0${i + 1}-00-00`), { recursive: true });
  b = spawnSync('node', ['--no-warnings', here('./backup.mjs')], { env: { ...cleanEnv, DATA_DIR: data, BACKUP_KEEP: '7' }, encoding: 'utf8' });
  const after = fs.readdirSync(bk).filter((f) => f.startsWith('snapshot-'));
  ok('only the oldest snapshots are pruned (newest 7 kept, the real backups survive)', after.length === 7 && !after.includes('snapshot-2020-01-01-00-00') && after.filter((f) => f.startsWith('snapshot-2026')).length >= 2, after.join());
  ok('backup of a missing database fails loudly', spawnSync('node', ['--no-warnings', here('./backup.mjs')], { env: { ...cleanEnv, DATA_DIR: tmp() }, encoding: 'utf8' }).status === 1);

  // recordings are copied, never duplicated or removed
  fs.mkdirSync(path.join(data, 'sermon-audio', 'c1'), { recursive: true }); fs.writeFileSync(path.join(data, 'sermon-audio', 'c1', 'abc.m4a'), 'fake audio');
  await sleep(1100);
  b = spawnSync('node', ['--no-warnings', here('./backup.mjs')], { env: { ...cleanEnv, DATA_DIR: data, BACKUP_KEEP: '7' }, encoding: 'utf8' });
  ok('new sermon recordings are copied into the backup', fs.existsSync(path.join(bk, 'sermon-audio', 'c1', 'abc.m4a')) && /1 new recordings/.test(b.stdout), b.stdout + b.stderr);

  // ---------------------------------------------------------------- the Docker image must contain every file the server loads
  {
    const docker = fs.readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');
    const copied = new Set((docker.match(/^COPY (.+) \.\/$/m) || [, ''])[1].split(/\s+/));
    const needed = new Set();
    for (const f of ['server.mjs', 'platform.mjs', 'console-api.mjs', 'providers.mjs', 'messages.mjs', 'bulk.mjs', 'clerks.mjs', 'sandbox.mjs', 'backup.mjs', 'restore.mjs', 'mpesa-register.mjs', 'smoke-test.mjs']) {
      needed.add(f);
      for (const m of fs.readFileSync(new URL('./' + f, import.meta.url), 'utf8').matchAll(/from '\.\/([\w.-]+\.mjs)'/g)) needed.add(m[1]);
    }
    const missing = [...needed].filter((f) => !copied.has(f));
    ok('the Docker image copies every file the server imports', missing.length === 0, 'missing: ' + missing.join(', '));
    ok('the Docker image copies the console page', copied.has('console.html'));
    // the repository-root Dockerfile (what Chajio Cloud builds) copies the whole server folder; the ignore file must not drop anything the server loads
    const root = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
    const ign = fs.readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    ok('the root Dockerfile copies the server folder and sets no storage promise', /^COPY server\/ \.\/$/m.test(root) && !/PERSISTENT_STORAGE/.test(root.replace(/#.*$/gm, '')));
    const dropped = [...needed, 'console.html'].filter((f) => ign.some((g) => g === 'server/' + f || (g.includes('*') && new RegExp('^' + g.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*') + '$').test('server/' + f))));
    ok('.dockerignore keeps every file the server loads', dropped.length === 0, dropped.join(', '));
    ok('the root Dockerfile listens on PORT and has a /health check', /PORT=8080/.test(root) && /\/health/.test(root) && /^CMD \["node"/m.test(root));
  }

  // ---------------------------------------------------------------- graceful shutdown
  const exited = new Promise((res) => srv.on('exit', (c) => res(c)));
  srv.kill('SIGTERM');
  const code0 = await Promise.race([exited, sleep(5000).then(() => 'timeout')]);
  ok('server shuts down cleanly on SIGTERM (docker stop)', code0 === 0, String(code0));
} catch (e) { fail++; console.log('ERROR', e); }

fake.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
