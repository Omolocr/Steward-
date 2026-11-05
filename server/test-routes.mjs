// Every screen the server can send in a push notification must be one the app opens when the notification is tapped.
// (A notification that opens nothing looks like a bug to the person who taps it.)  Run: node --no-warnings test-routes.mjs
import fs from 'node:fs';
const here = (f) => new URL(f, import.meta.url).pathname;
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const app = fs.readFileSync(here('../App.tsx'), 'utf8');
const tap = Object.fromEntries([...app.slice(app.indexOf('TAP_ROUTES'), app.indexOf('};', app.indexOf('TAP_ROUTES'))).matchAll(/(\w+):\s*'(\w+)'/g)].map((m) => [m[1], m[2]]));
const routes = new Set([...app.slice(app.indexOf('const ROUTES'), app.indexOf('\n};', app.indexOf('const ROUTES'))).matchAll(/(\w+):\s*[A-Z]\w*/g)].map((m) => m[1]));
// every literal the server can put in { screen: ... }, including the ones chosen by a ternary
const sent = new Set();
for (const f of fs.readdirSync(here('.')).filter((x) => x.endsWith('.mjs') && !x.startsWith('test'))) {
  for (const line of fs.readFileSync(here('./' + f), 'utf8').split('\n')) {
    const i = line.indexOf('screen:'); if (i < 0) continue;
    for (const m of line.slice(i).replace(/\w+\s*===\s*'\w+'/g, '').matchAll(/'(\w+)'/g)) sent.add(m[1]); // skip the conditions of a ternary
  }
}
ok('found the screens the server sends', sent.size >= 6, [...sent].join());
for (const s of sent) {
  if (s === 'support') continue; // opens the chat widget, handled separately in PushBridge
  ok(`push screen "${s}" opens something when tapped`, !!tap[s], 'missing in TAP_ROUTES');
  ok(`push screen "${s}" leads to a real screen`, routes.has(tap[s] || s), `no route named ${tap[s] || s}`);
}
ok('the support chat tap is handled', /s === 'support'/.test(app));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
