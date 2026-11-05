// Stops a release build that still has example values in it, so a published app can never point at the wrong server or fail to
// register for push notifications.   Run:  node scripts/check-release.mjs        (EAS runs it before every "production" build)
import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const read = (f) => JSON.parse(fs.readFileSync(root + f, 'utf8'));
const problems = [];
const app = read('app.json').expo;
const pid = app?.extra?.eas?.projectId ?? '';
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid)) problems.push(`app.json: extra.eas.projectId is "${pid}". Run "npx eas init" and put the project id there (or: node scripts/configure-app.mjs --eas-project-id <id>). Without it push notifications cannot register.`);
const eas = read('eas.json');
for (const [name, p] of Object.entries(eas.build ?? {})) {
  const url = p.env?.EXPO_PUBLIC_API_URL;
  if (!url) { problems.push(`eas.json: build profile "${name}" has no EXPO_PUBLIC_API_URL.`); continue; }
  let u; try { u = new URL(url); } catch { problems.push(`eas.json: profile "${name}": "${url}" is not a web address.`); continue; }
  if (u.protocol !== 'https:') problems.push(`eas.json: profile "${name}": ${url} must start with https:// (phones refuse plain http in release builds).`);
  if (/yourchurch\.org$/i.test(u.hostname) || /^(localhost|10\.0\.2\.2|127\.|192\.168\.)/.test(u.hostname)) problems.push(`eas.json: profile "${name}" still points at the example/local address ${url}. Use the address of your real server (node scripts/configure-app.mjs --api-url https://...).`);
}
if (problems.length) { console.error('\nNOT READY TO RELEASE:\n - ' + problems.join('\n - ') + '\n'); process.exit(1); }
console.log('Release settings look right: server ' + Object.values(eas.build).map((p) => p.env.EXPO_PUBLIC_API_URL)[0] + ', EAS project ' + pid);
