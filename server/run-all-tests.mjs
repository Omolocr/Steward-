// Runs EVERY automatic test and prints one summary.   cd server && npm run test:all     (or from the top folder: npm test)
// Exit code 0 only if all of them pass. A test file that is not listed here fails the run, so nothing is forgotten.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const dir = new URL('.', import.meta.url).pathname;
const PLAIN = ['test', 'test-services', 'test-ops', 'test-mpesa', 'test-smoke', 'test-reports', 'test-console', 'test-parity', 'test-lang-push',
  'test-office-tools', 'test-admin-tools', 'test-dev-reports', 'test-guide', 'test-reminders', 'test-yearly', 'test-clerk-tools', 'test-sandbox', 'test-routes'];
const STRIP = ['test-minutes', 'test-outbox', 'test-quickcard', 'test-sermon']; // test the app's own TypeScript logic: need --experimental-strip-types
const only = process.argv[2];
const on_disk = fs.readdirSync(dir).filter((f) => /^test.*\.mjs$/.test(f)).map((f) => f.replace(/\.mjs$/, ''));
const unlisted = on_disk.filter((t) => !PLAIN.includes(t) && !STRIP.includes(t));
const missing = [...PLAIN, ...STRIP].filter((t) => !on_disk.includes(t));
let bad = 0, total = 0, suites = 0;
if (unlisted.length || missing.length) { console.error('Test list is out of date. Not listed: ' + unlisted.join(', ') + ' | Missing files: ' + missing.join(', ')); bad++; }
for (const t of [...PLAIN, ...STRIP]) {
  if (only && t !== only) continue;
  const args = ['--no-warnings', ...(STRIP.includes(t) ? ['--experimental-strip-types'] : []), t + '.mjs'];
  const r = spawnSync('node', args, { cwd: dir, encoding: 'utf8', timeout: 600000 });
  const m = (r.stdout || '').match(/(\d+) passed, (\d+) failed/) || (r.stdout || '').match(/(\d+) passed.*?(\d+) failed/);
  const p = m ? Number(m[1]) : 0, f = m ? Number(m[2]) : 1;
  suites++; total += p;
  const good = r.status === 0 && f === 0 && !!m;
  if (!good) { bad++; console.log(`FAIL ${t}: ${p} passed, ${f} failed${m ? '' : ' (no summary line)'}`); console.log((r.stdout || '').split('\n').filter((l) => /FAIL/.test(l)).slice(0, 5).join('\n') + (r.stderr || '').slice(0, 400)); }
  else console.log(`ok   ${t}: ${p} checks`);
}
console.log(`\n${suites} suites, ${total} checks passed, ${bad} suite(s) failed`);
process.exit(bad ? 1 : 0);
