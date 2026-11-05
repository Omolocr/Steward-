// Offline outbox: minutes, notices, activities, office records and care messages written without internet wait on the phone and are
// sent automatically when the connection is back. Money is never queued (payments and receipts always need the server).
// Plain logic with no screens or network of its own, so it can be tested. Nothing is lost: an item leaves the queue only after the server
// has accepted it, and one the server refuses is kept (with the reason) until the person hides it.
export interface QItem { key: string; col: string; /** Where to send it, when it is not a plain new record (e.g. confirming a payment). */ path?: string; data: Record<string, unknown>; title: string; at: string; tries: number }
export interface Rejected extends QItem { reason: string; rejectedAt: string; hidden?: boolean }
export interface Stored { queue: QItem[]; rejected: Rejected[] }
export interface KV { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> }
export interface SendError { status: number; message: string }
export interface FlushResult { sent: number; rejected: number; left: number; stopped: 'offline' | 'session' | null }

/** Only low-risk additions can wait offline. */
export const QUEUEABLE = ['minutes', 'notices', 'activities', 'office', 'care'] as const;
export const isQueueable = (col: string) => (QUEUEABLE as readonly string[]).includes(col);

/** A one-off key for each queued item (16 to 64 letters, digits, - or _). The server uses it to ignore a repeat of the same send. */
export const newKey = (rand: () => number = Math.random) => 'ob-' + Date.now().toString(36) + '-' + Array.from({ length: 14 }, () => Math.floor(rand() * 36).toString(36)).join('');

const MAX_QUEUE = 200;
const empty = (): Stored => ({ queue: [], rejected: [] });

export function createOutbox(kv: KV, userId: string) {
  const storeKey = `church-outbox-v1-${userId}`;
  let running: Promise<FlushResult> | null = null;

  const load = async (): Promise<Stored> => {
    try {
      const raw = await kv.getItem(storeKey); if (!raw) return empty();
      const p = JSON.parse(raw) as Partial<Stored>;
      return { queue: Array.isArray(p.queue) ? p.queue : [], rejected: Array.isArray(p.rejected) ? p.rejected : [] };
    } catch { return empty(); }
  };
  const save = (s: Stored) => kv.setItem(storeKey, JSON.stringify(s));

  return {
    load,
    /** Adds an item. Returns false when the queue is full (the caller should tell the person). */
    async enqueue(item: { key: string; col: string; path?: string; data: Record<string, unknown>; title: string }): Promise<boolean> {
      const s = await load();
      if (s.queue.length >= MAX_QUEUE) return false;
      if (s.queue.some((q) => q.key === item.key)) return true;
      s.queue.push({ ...item, at: new Date().toISOString(), tries: 0 });
      await save(s); return true;
    },
    /** Sends the waiting items in the order they were written. `send` must throw { status, message } when the server says no. */
    flush(send: (item: QItem) => Promise<unknown>): Promise<FlushResult> {
      if (running) return running; // a second call while one is running waits for the first
      running = (async () => {
        const res: FlushResult = { sent: 0, rejected: 0, left: 0, stopped: null };
        const s = await load();
        const rest: QItem[] = [];
        for (let i = 0; i < s.queue.length; i++) {
          const it = s.queue[i];
          if (res.stopped) { rest.push(it); continue; }
          try { await send(it); res.sent++; }
          catch (e) {
            const err = e as Partial<SendError>; const st = typeof err.status === 'number' ? err.status : 0;
            if (st === 0 || st >= 500) { res.stopped = 'offline'; rest.push({ ...it, tries: it.tries + 1 }); }
            else if (st === 401) { res.stopped = 'session'; rest.push(it); }
            else { s.rejected.push({ ...it, tries: it.tries + 1, reason: String(err.message || 'Not accepted'), rejectedAt: new Date().toISOString() }); res.rejected++; }
          }
          // Save after every item, so a crash never sends the same item again without the server's repeat-protection noticing.
          await save({ queue: [...rest, ...s.queue.slice(i + 1)], rejected: s.rejected });
        }
        await save({ queue: rest, rejected: s.rejected });
        res.left = rest.length; return res;
      })().finally(() => { running = null; });
      return running;
    },
    /** Hides a refused item from the list. It is kept on the phone (hidden), not erased. */
    async hide(key: string) { const s = await load(); const r = s.rejected.find((x) => x.key === key); if (r) { r.hidden = true; await save(s); } },
    async counts() { const s = await load(); return { queued: s.queue.length, rejected: s.rejected.filter((r) => !r.hidden).length }; },
  };
}
