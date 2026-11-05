// Sermon recording safety: the unfinished-recordings list and the follow-the-job loop.
// Run: node --no-warnings --experimental-strip-types test-sermon.mjs
import { followJob } from '../src/services/sermonFollow.ts';
import { createSermonQueue } from '../src/services/sermonQueue.ts';
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + x)); };
const mem = () => { const m = new Map(); return { m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } }; };
const job = (status) => ({ id: 'j1', title: 't', status, stage: null, error: status === 'failed' ? 'bad audio' : null, quickReady: false, generalReady: false, kidsReady: false });
const net = (s = 0) => Object.assign(new Error('network'), { status: s });
let clock = 0; const fake = (script, extra = {}) => { let i = 0; const waits = []; return { waits, env: { get: async () => { const x = script[Math.min(i++, script.length - 1)]; if (x instanceof Error) throw x; return x; }, sleep: async (ms) => { waits.push(ms); clock += ms; }, now: () => clock, ...extra } }; };

// ---- follow
{ clock = 0; const f = fake([job('queued'), job('transcribing'), job('summarizing'), job('done')]); const seen = [];
  const r = await followJob('j1', { ...f.env, onUpdate: (j) => seen.push(j.status) });
  ok('follows the job until the summaries are done', r.kind === 'done' && seen.join() === 'queued,transcribing,summarizing,done'); ok('checks every 3 seconds while all is well', f.waits.every((w) => w === 3000)); }
{ clock = 0; const f = fake([job('transcribing'), job('failed')]); const r = await followJob('j1', f.env); ok('a failed job is reported with the reason', r.kind === 'failed' && r.job.error === 'bad audio'); }
{ clock = 0; const f = fake([net(0)]); const r = await followJob('j1', f.env);
  ok('a server that cannot be reached stops after 6 tries and says "offline" instead of waiting forever', r.kind === 'offline' && f.waits.length === 6, JSON.stringify(f.waits));
  ok('the waits grow (backoff) up to 30 seconds', f.waits[1] === 6000 && f.waits[2] === 12000 && Math.max(...f.waits) === 30000, JSON.stringify(f.waits)); }
{ clock = 0; const f = fake([job('queued'), net(503), net(0), job('summarizing'), job('done')]); const r = await followJob('j1', f.env); ok('a short outage in the middle is survived', r.kind === 'done'); }
{ clock = 0; const f = fake([net(0), net(0), job('queued'), net(0), net(0), job('done')]); const r = await followJob('j1', f.env); ok('the failure count restarts after a good answer', r.kind === 'done'); }
{ clock = 0; const f = fake([net(404)]); let thrown = null; try { await followJob('j1', f.env); } catch (e) { thrown = e; } ok('a "not found" is a real error, not retried for ever', thrown && thrown.status === 404 && f.waits.length === 1); }
{ clock = 0; const f = fake([job('transcribing')], { maxTotalMs: 600000 }); const r = await followJob('j1', f.env); ok('after the time limit it says the job is slow and keeps the job', r.kind === 'slow' && r.job.status === 'transcribing'); }
{ clock = 0; let alive = true; const f = fake([job('queued')], { alive: () => alive }); const p = followJob('j1', { ...f.env, sleep: async () => { alive = false; } }); ok('leaving the screen stops the checking', (await p).kind === 'left'); }

// ---- the unfinished-recordings list
{ const kv = mem(); const q = createSermonQueue(kv, 'u1');
  await q.add({ id: 's1', uri: 'file:///docs/s1.m4a', title: 'Hope', preacher: 'Pastor', seconds: 1800 });
  const again = createSermonQueue(kv, 'u1'); // "the app was closed and opened again"
  const l = await again.list(); ok('a recording survives closing the app', l.length === 1 && l[0].uri === 'file:///docs/s1.m4a' && l[0].state === 'recorded');
  await again.sent('s1', 'job9'); ok('once uploaded it remembers the server job', (await again.list())[0].state === 'sent' && (await again.list())[0].jobId === 'job9');
  await again.add({ id: 's1', uri: 'x', title: 'dup', preacher: 'p' }); ok('the same recording is not listed twice', (await again.list()).length === 1);
  await again.tried('s1'); ok('upload attempts are counted', (await again.list())[0].tries === 1);
  ok('another person on the same phone does not see it', (await createSermonQueue(kv, 'u2').list()).length === 0);
  await again.remove('s1'); ok('it leaves the list when the summaries are made', (await again.list()).length === 0); }
{ const kv = mem(); const q = createSermonQueue(kv, 'u1'); await Promise.all([1, 2, 3, 4, 5].map((i) => q.add({ id: 's' + i, uri: 'u' + i, title: 't', preacher: 'p' })));
  ok('five quick changes at once all survive', (await q.list()).length === 5); }
{ const kv = mem(); kv.m.set('church-sermons-pending-v1-u1', '{broken'); ok('damaged storage does not crash the app', (await createSermonQueue(kv, 'u1').list()).length === 0); }
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
