// Follows a sermon job on the church server until it finishes, with a limit on how long it keeps trying.
// Pure logic (no phone libraries) so it is tested on its own: server/test-sermon.mjs.
import type { SermonJob } from './sermon';

export type FollowResult =
  | { kind: 'done'; job: SermonJob }
  | { kind: 'failed'; job: SermonJob }
  | { kind: 'offline'; job: SermonJob | null }   // the server could not be reached several times in a row: the job is NOT lost, ask again later
  | { kind: 'slow'; job: SermonJob | null }      // still working after a very long time: tell the person, keep the job id
  | { kind: 'left' };                            // the person left the screen

export interface FollowEnv {
  get: (id: string) => Promise<SermonJob>;
  onUpdate?: (j: SermonJob) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  alive?: () => boolean;
  baseMs?: number;          // wait between checks (3 s)
  maxMs?: number;           // longest wait while the connection is bad (30 s)
  maxFails?: number;        // consecutive failed checks before saying "offline" (6: about 2 minutes)
  maxTotalMs?: number;      // give up waiting on screen after this long (90 minutes)
}

export async function followJob(id: string, env: FollowEnv): Promise<FollowResult> {
  const sleep = env.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = env.now ?? Date.now;
  const base = env.baseMs ?? 3000, cap = env.maxMs ?? 30000, maxFails = env.maxFails ?? 6, maxTotal = env.maxTotalMs ?? 90 * 60e3;
  const started = now();
  let fails = 0, last: SermonJob | null = null;
  for (;;) {
    await sleep(fails ? Math.min(cap, base * 2 ** fails) : base);
    if (env.alive && !env.alive()) return { kind: 'left' };
    try {
      const j = await env.get(id);
      fails = 0; last = j; env.onUpdate?.(j);
      if (j.status === 'done') return { kind: 'done', job: j };
      if (j.status === 'failed') return { kind: 'failed', job: j };
    } catch (e) {
      // A refusal such as "not found" will never get better by waiting; only connection problems and server errors are retried.
      const st = (e as { status?: number } | null)?.status;
      if (typeof st === 'number' && st >= 400 && st < 500 && st !== 408 && st !== 429) throw e;
      if (++fails >= maxFails) return { kind: 'offline', job: last };
    }
    if (now() - started > maxTotal) return { kind: 'slow', job: last };
  }
}
