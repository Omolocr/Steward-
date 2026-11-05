// Sets the two values every release needs, in the right files, without hand-editing JSON.
//   node scripts/configure-app.mjs --api-url https://api.mychurch.org --eas-project-id 1234abcd-....
// (either option on its own is fine). Then:  node scripts/check-release.mjs
import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const url = arg('api-url'), pid = arg('eas-project-id');
if (!url && !pid) { console.error('Usage: node scripts/configure-app.mjs --api-url https://api.mychurch.org --eas-project-id <id>'); process.exit(1); }
if (url) {
  let u; try { u = new URL(url); } catch { console.error('Not a web address: ' + url); process.exit(1); }
  if (u.protocol !== 'https:') { console.error('The server address must start with https://'); process.exit(1); }
  const f = root + 'eas.json', j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const p of Object.values(j.build ?? {})) { p.env = { ...(p.env ?? {}), EXPO_PUBLIC_API_URL: u.origin }; }
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); console.log('eas.json: server address set to ' + u.origin);
}
if (pid) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid)) { console.error('That is not an EAS project id (it looks like 12345678-1234-1234-1234-123456789abc).'); process.exit(1); }
  const f = root + 'app.json', j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.expo.extra = { ...(j.expo.extra ?? {}), eas: { ...(j.expo.extra?.eas ?? {}), projectId: pid } };
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); console.log('app.json: EAS project id set.');
}
