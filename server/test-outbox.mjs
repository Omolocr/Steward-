// Offline outbox logic (from the app). Run: node --no-warnings --experimental-strip-types test-outbox.mjs
import { createOutbox, isQueueable, newKey } from '../src/outbox.ts';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const mem = () => { const m = new Map(); return { m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } }; };
const item = (n, over = {}) => ({ key: newKey(), col: 'minutes', data: { title: 'T' + n }, title: 'T' + n, ...over });
const err = (status, message = 'x') => ({ status, message });

ok('only low-risk things can wait offline', ['minutes', 'notices', 'activities', 'office', 'care'].every(isQueueable) && !['payments', 'receipts', 'memberships', 'welfare', 'projects', 'sermons', 'campreg'].some(isQueueable));
const keys = new Set(Array.from({ length: 500 }, () => newKey())); 
ok('keys are unique and in the form the server accepts', keys.size === 500 && [...keys].every((k) => /^[A-Za-z0-9_-]{16,64}$/.test(k)));

{ // order, persistence, success
  const kv = mem(); const a = createOutbox(kv, 'u1'); const sent = [];
  for (let i = 1; i <= 3; i++) await a.enqueue(item(i));
  ok('items are counted', (await a.counts()).queued === 3);
  const b = createOutbox(kv, 'u1'); // "the app was closed and opened again"
  ok('they survive closing the app', (await b.load()).queue.length === 3);
  const r = await b.flush(async (it) => { sent.push(it.title); });
  ok('all are sent, in the order they were written', r.sent === 3 && r.left === 0 && sent.join() === 'T1,T2,T3');
  ok('the queue is empty afterwards', (await b.counts()).queued === 0);
}
{ // offline: stop at the first failure and keep the rest in order
  const kv = mem(); const a = createOutbox(kv, 'u1'); for (let i = 1; i <= 4; i++) await a.enqueue(item(i));
  let n = 0; const r = await a.flush(async () => { n++; if (n === 2) throw err(0, 'offline'); });
  ok('a lost connection stops the sending without losing anything', r.sent === 1 && r.left === 3 && r.stopped === 'offline' && n === 2, JSON.stringify(r));
  const q = (await a.load()).queue; ok('the failed item stays first and its retry is counted', q[0].title === 'T2' && q[0].tries === 1 && q.map((x) => x.title).join() === 'T2,T3,T4');
  const r2 = await a.flush(async () => {}); ok('the rest is sent next time', r2.sent === 3 && r2.left === 0);
}
{ // a server error (5xx) is retried, a refusal (4xx) is kept with its reason
  const kv = mem(); const a = createOutbox(kv, 'u1'); await a.enqueue(item(1)); await a.enqueue(item(2)); await a.enqueue(item(3));
  let r = await a.flush(async (it) => { if (it.title === 'T1') throw err(503); });
  ok('a server error is retried later, not dropped', r.stopped === 'offline' && r.left === 3 && r.sent === 0);
  r = await a.flush(async (it) => { if (it.title === 'T2') throw err(403, 'You are not allowed to add this.'); });
  ok('a refusal does not block the others', r.sent === 2 && r.rejected === 1 && r.left === 0, JSON.stringify(r));
  const s = await a.load(); ok('the refused item is kept with the reason', s.rejected.length === 1 && s.rejected[0].reason === 'You are not allowed to add this.' && s.rejected[0].title === 'T2');
  ok('it is counted until hidden', (await a.counts()).rejected === 1);
  await a.hide(s.rejected[0].key); ok('hiding keeps it on the phone but stops counting it', (await a.counts()).rejected === 0 && (await a.load()).rejected.length === 1 && (await a.load()).rejected[0].hidden === true);
}
{ // session expired
  const kv = mem(); const a = createOutbox(kv, 'u1'); await a.enqueue(item(1)); await a.enqueue(item(2));
  const r = await a.flush(async () => { throw err(401, 'Please sign in.'); });
  ok('an expired sign-in keeps everything and says why', r.stopped === 'session' && r.left === 2 && r.sent === 0 && (await a.load()).rejected.length === 0);
}
{ // people do not share queues
  const kv = mem(); const a = createOutbox(kv, 'u1'), b = createOutbox(kv, 'u2'); await a.enqueue(item(1));
  ok('another person on the same phone has their own queue', (await b.counts()).queued === 0);
  let sentForB = 0; await b.flush(async () => { sentForB++; }); ok('and nothing of the first person is sent as them', sentForB === 0 && (await a.counts()).queued === 1);
}
{ // two flushes at once do not send twice
  const kv = mem(); const a = createOutbox(kv, 'u1'); await a.enqueue(item(1)); await a.enqueue(item(2)); let sends = 0;
  const slow = async () => { sends++; await new Promise((r) => setTimeout(r, 30)); };
  const [x, y] = await Promise.all([a.flush(slow), a.flush(slow)]);
  ok('a second flush while one is running joins it (no double send)', sends === 2 && x === y, 'sends=' + sends);
}
{ // the same key is not queued twice; the queue has a limit
  const kv = mem(); const a = createOutbox(kv, 'u1'); const it = item(1); await a.enqueue(it); await a.enqueue(it);
  ok('the same item is not queued twice', (await a.counts()).queued === 1);
  let full = true; for (let i = 0; i < 205; i++) full = (await a.enqueue(item(i))) && full;
  ok('the queue has a limit and says so', (await a.counts()).queued === 200 && full === false);
}
{ // damaged storage
  const kv = mem(); kv.m.set('church-outbox-v1-u1', '{not json'); const a = createOutbox(kv, 'u1');
  ok('damaged storage does not crash the app', (await a.counts()).queued === 0 && (await a.enqueue(item(1))) === true && (await a.counts()).queued === 1);
}
{ // a crash half-way: the item that was sent is not sent again
  const kv = mem(); const a = createOutbox(kv, 'u1'); await a.enqueue(item(1)); await a.enqueue(item(2)); await a.enqueue(item(3));
  let n = 0; try { await a.flush(async () => { n++; if (n === 2) throw new Error('app killed'); }); } catch { /* the app was killed */ }
  const left = (await createOutbox(kv, 'u1').load()).queue.map((x) => x.title).join();
  ok('after a crash only the unsent items remain', left === 'T2,T3' || left === 'T1,T2,T3'.replace('T1,', ''), left);
}
{ // a payment confirmation keeps its own address, and is not queued twice
  const kv = mem(); const a = createOutbox(kv, 'tr');
  const it = { key: 'ob-rcv-pay1234567890', col: 'payments', path: '/payments/pay1/receive', data: {}, title: 'Grace KSh 500' };
  await a.enqueue(it); await a.enqueue(it);
  const q = (await createOutbox(kv, 'tr').load()).queue;
  ok('a confirmation keeps its address and is queued once', q.length === 1 && q[0].path === '/payments/pay1/receive');
  let seen = ''; await a.flush(async (x) => { seen = x.path ?? '/records/' + x.col; });
  ok('it is sent to that address', seen === '/payments/pay1/receive');
  ok('payments are still not a plain queueable record', !isQueueable('payments'));
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
