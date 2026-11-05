// Quick-start card. Run: node --no-warnings --experimental-strip-types test-quickcard.mjs
import { composeQuickCard } from '../src/services/quickcard.ts';
import { guideFor } from '../src/data/guides.ts';
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + x)); };
const id = (s) => s;
const roles = ['member', 'treasurer', 'secretary', 'clerk', 'pastor', 'elder1', 'camp_secretary', 'dorcas_leader', 'former_leader'];
for (const r of roles) {
  const g = guideFor(r); const t = composeQuickCard(g, 'Mavuno SDA Church', id);
  ok(`${r}: card has church, title, every step numbered`, t.includes('Mavuno SDA Church') && t.includes(g.title) && g.steps.every((s, i) => t.includes(`${i + 1}. ${s.icon} ${s.title}`) && t.includes(s.body)));
}
const t = composeQuickCard(guideFor('treasurer'), 'X', id);
ok('no church number or personal data on the card', !/\d{3}-\d{4}/.test(t) && !/07\d{8}/.test(t));
ok('translated through the supplied function', composeQuickCard(guideFor('member'), 'X', (s) => '«' + s + '»').includes('«Give by M-Pesa»'));
ok('heading is upper-cased', t.startsWith('QUICK-START CARD'));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
