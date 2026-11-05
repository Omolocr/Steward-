// Recordings that are on this phone but not yet turned into summaries. Kept in storage so a restart, a crash or a lost
// connection never loses a sermon: the Sermon screen lists them and lets the person send or check them again.
// Pure logic (storage is passed in) so it is tested on its own: server/test-sermon.mjs.
export interface KV { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> }

export type PendingState = 'recorded' | 'sent';   // recorded: file on the phone, not uploaded yet. sent: uploaded, the server is working (jobId)
export interface PendingSermon {
  id: string; uri: string; title: string; preacher: string;
  savedAt: string; state: PendingState; jobId?: string; tries: number; seconds?: number;
}

export function createSermonQueue(kv: KV, userId: string) {
  const key = `church-sermons-pending-v1-${userId}`;
  const load = async (): Promise<PendingSermon[]> => {
    try { const v = JSON.parse((await kv.getItem(key)) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
  };
  const save = (l: PendingSermon[]) => kv.setItem(key, JSON.stringify(l));
  let chain: Promise<unknown> = Promise.resolve();  // one change at a time, so two quick updates cannot overwrite each other
  const edit = <T>(fn: (l: PendingSermon[]) => T): Promise<T> => {
    const p = chain.then(async () => { const l = await load(); const r = fn(l); await save(l); return r; });
    chain = p.catch(() => undefined); return p;
  };
  return {
    list: load,
    add: (s: Omit<PendingSermon, 'tries' | 'state' | 'savedAt'> & { savedAt?: string }) =>
      edit((l) => { if (!l.some((x) => x.id === s.id)) l.push({ ...s, state: 'recorded', tries: 0, savedAt: s.savedAt ?? new Date().toISOString() }); }),
    sent: (id: string, jobId: string) => edit((l) => { const x = l.find((y) => y.id === id); if (x) { x.state = 'sent'; x.jobId = jobId; } }),
    tried: (id: string) => edit((l) => { const x = l.find((y) => y.id === id); if (x) x.tries++; }),
    /** Finished (summaries made) or abandoned by the person: it leaves the list. */
    remove: (id: string) => edit((l) => { const i = l.findIndex((y) => y.id === id); if (i >= 0) l.splice(i, 1); }),
  };
}
