import { unregisterPush } from '../push';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '../i18n';
import { api, ApiError, setToken } from '../api';
import { createOutbox, isQueueable, newKey, Rejected, QItem } from '../outbox';
import { AuditEntry, Church, ChurchSettings, CollectionName, DB, UnclaimedPayment, User } from '../types';

const TOKEN_KEY = 'church-app-token-v2';
const COLLECTIONS: CollectionName[] = ['notices', 'payments', 'receipts', 'memberships', 'welfare', 'projects', 'minutes', 'care', 'sermons', 'activities', 'office', 'campreg'];
const REFRESH_MS = 20000;
const SNAP_KEY = 'church-app-snapshot-v1';

const emptyDB = (): DB => ({
  users: [], pendingRoles: [], notices: [], payments: [], receipts: [], memberships: [], welfare: [],
  projects: [], minutes: [], care: [], sermons: [], activities: [], office: [], campreg: [], audit: [], unclaimed: [], mpesaEnabled: false,
});

/** What a new person tells us. The church (name, district, station…) comes from the church number, so it is not asked here. */
export interface SandboxNumber { phone: string; console: 'developer' | 'church_admin' | 'leader' | 'member'; role: string; label: string }
export interface Profile {
  name: string; idNumber: string; membershipNumber?: string; role?: string; formerRoles: string[]; groups: string[];
}
/** The /me answer: who I am, which church I am bound to, that church's settings, and whether I am still waiting to be let in. */
interface MeResponse { user: User; joinStatus?: 'approved' | 'pending'; church?: Church; settings?: ChurchSettings; supportUnread?: number }

interface Ctx {
  ready: boolean;
  online: boolean;
  db: DB;
  me: User | null;
  /** The one church this person belongs to. Everything in the app is linked only to it. */
  church: Church | null;
  settings: ChurchSettings | null;
  /** 'pending' = entered the church number and is waiting for the Church Admin to let them in. */
  joinStatus: 'approved' | 'pending';
  /** Church Admin only: unread messages from the app developers. */
  supportUnread: number;
  requestOtp: (phone: string) => Promise<{ ok: boolean; devCode?: string }>;
  verifyOtp: (phone: string, code: string, profile?: Profile, churchNumber?: string) => Promise<'ok' | 'needs-profile' | 'needs-church' | 'error'>;
  /** Is this phone already bound to a church? Does this church number exist (and what is the church called)? */
  /** Team test numbers, only when the server is a sandbox (made-up data). Null on a normal server. */
  sandbox: SandboxNumber[] | null;
  /** Sign in at once with a team test number (no SMS code). */
  enterSandbox: (phone: string) => Promise<'ok' | 'developer' | 'error'>;
  lookup: (phone: string, churchNumber?: string) => Promise<{ bound: boolean; church?: { name: string } | null } | null>;
  /** Move to another church: needs a fresh SMS code and the new church's number. The old membership is archived, not deleted. */
  moveChurch: (churchNumber: string, code: string, groups: string[]) => Promise<boolean>;
  signOut: () => void;
  /** Things written without internet that wait on this phone (and ones the church refused). */
  outbox: { queued: QItem[]; rejected: Rejected[] };
  /** Send the waiting items now. Returns how many were sent. */
  sendOutbox: () => Promise<number>;
  hideRejected: (key: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Add a record. The server decides ownership, status and permissions. Never overwrites anything. */
  add: (c: CollectionName, data: Record<string, unknown>) => Promise<boolean>;
  /** Archive (the only way to remove something from view). The record is kept forever. */
  archive: (c: CollectionName, id: string, reason?: string) => Promise<boolean>;
  unarchive: (c: CollectionName, id: string) => Promise<boolean>;
  receivePayment: (id: string) => Promise<boolean>;
  /** Treasurer: confirms every payment M-Pesa has already verified, in one go. Returns how many were confirmed (or -1 if it failed). */
  receiveVerified: () => Promise<number>;
  approveNotice: (id: string) => Promise<boolean>;
  decideMembership: (id: string, approve: boolean) => Promise<boolean>;
  decideRole: (userId: string, approve: boolean) => Promise<boolean>;
  /** A member applies for membership by transfer; the application goes to the Church Board. */
  applyTransfer: (data: { fromChurch: string; transferLetterRef?: string; note?: string }) => Promise<boolean>;
  /** Camp officers: set the fee, record a payment, or check a person in (or undo it). */
  campAction: (id: string, action: 'fee' | 'payment' | 'checkin' | 'uncheck', amount?: number) => Promise<boolean>;
}

const DBContext = createContext<Ctx>(null as unknown as Ctx);
export const useDB = () => useContext(DBContext);

export function DBProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB>(emptyDB());
  const [me, setMe] = useState<User | null>(null);
  const [church, setChurch] = useState<Church | null>(null);
  const [settings, setSettings] = useState<ChurchSettings | null>(null);
  const [joinStatus, setJoinStatus] = useState<'approved' | 'pending'>('approved');
  const [supportUnread, setSupportUnread] = useState(0);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const signedIn = useRef(false);
  const [outbox, setOutbox] = useState<{ queued: QItem[]; rejected: Rejected[] }>({ queued: [], rejected: [] });
  const meRef = useRef<User | null>(null);
  meRef.current = me;
  const boxFor = (id: string) => createOutbox(AsyncStorage, id);
  const readBox = useCallback(async (id: string) => {
    const s = await boxFor(id).load();
    setOutbox({ queued: s.queue, rejected: s.rejected.filter((r) => !r.hidden) });
  }, []);
  const flushing = useRef(false);
  const flushBox = useCallback(async (): Promise<number> => {
    const u = meRef.current; if (!u || flushing.current) return 0;
    flushing.current = true;
    try {
      const r = await boxFor(u.id).flush((it) => api.post(it.path ?? `/records/${it.col}`, it.data, { 'X-Idempotency-Key': it.key }).then(() => undefined)
        // Confirming a payment that someone already confirmed is not a failure: the money is receipted either way.
        .catch((e) => { if (it.path && e instanceof ApiError && e.status === 409) return; throw e; }));
      await readBox(u.id);
      return r.sent;
    } catch { return 0; } finally { flushing.current = false; }
  }, [readBox]);

  const load = useCallback(async (user: User) => {
    try {
      const next = emptyDB();
      const [users, ...cols] = await Promise.all([
        api.get<{ users: User[] }>('/users'),
        ...COLLECTIONS.map((c) => api.get<{ records: unknown[] }>(`/records/${c}?archived=1`)),
      ]);
      next.users = users.users;
      COLLECTIONS.forEach((c, i) => { (next[c] as unknown[]) = cols[i].records; });
      if (user.role === 'secretary' || user.role === 'pastor' || user.role === 'church_admin') {
        next.pendingRoles = (await api.get<{ users: User[] }>('/users/pending-roles')).users;
        next.audit = (await api.get<{ audit: AuditEntry[] }>('/audit')).audit;
      }
      if (user.role === 'treasurer' || user.role === 'pastor') {
        const f = await api.get<{ enabled: boolean; transactions: UnclaimedPayment[] }>('/finance/unclaimed');
        next.unclaimed = f.transactions; next.mpesaEnabled = f.enabled;
      }
      setDb(next);
      setOnline(true);
      // A copy for reading when there is no internet (not the audit trail or unclaimed payments).
      AsyncStorage.setItem(SNAP_KEY, JSON.stringify({ uid: user.id, db: { ...next, audit: [], unclaimed: [] } })).catch(() => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { signOutNow(); return; }
      if (e instanceof ApiError && e.status === 403) return; // still waiting to be let in: nothing to load yet
      setOnline(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOutNow = () => {
    unregisterPush();
    signedIn.current = false; setToken(null); setMe(null); setChurch(null); setSettings(null); setJoinStatus('approved'); setSupportUnread(0); setDb(emptyDB());
    AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
    AsyncStorage.removeItem(SNAP_KEY).catch(() => {});
    setOutbox({ queued: [], rejected: [] });
  };

  // Takes the /me answer into the app. Returns the user so the lists can be loaded.
  const applyMe = useCallback((r: MeResponse) => {
    setMe(r.user); setJoinStatus(r.joinStatus ?? 'approved');
    if (r.church) setChurch(r.church);
    if (r.settings) setSettings(r.settings);
    setSupportUnread(r.supportUnread ?? 0);
  }, []);

  const start = useCallback(async (t: string) => {
    setToken(t); signedIn.current = true;
    await AsyncStorage.setItem(TOKEN_KEY, t).catch(() => {});
    const r = await api.get<MeResponse>('/me');
    applyMe(r);
    if ((r.joinStatus ?? 'approved') === 'approved') await load(r.user);
    await readBox(r.user.id);
    flushBox();
  }, [load, applyMe, readBox, flushBox]);

  const [sandbox, setSandbox] = useState<SandboxNumber[] | null>(null);
  useEffect(() => { // a normal server answers 404: then nothing is shown
    api.get<{ numbers: SandboxNumber[] }>('/sandbox/numbers').then((r) => setSandbox(r.numbers)).catch(() => setSandbox(null));
  }, []);
  const enterSandbox: Ctx['enterSandbox'] = useCallback(async (phone) => {
    try {
      const r = await api.post<{ token: string; kind: string }>('/sandbox/enter', { phone });
      if (r.kind === 'developer') return 'developer'; // the developer console is a web page: /console
      await start(r.token); return 'ok';
    } catch (e) { Alert.alert('Could not enter', e instanceof Error ? e.message : 'Try again.'); return 'error'; }
  }, [start]);

  // Restore the previous sign-in.
  useEffect(() => {
    (async () => {
      try {
        const t = await AsyncStorage.getItem(TOKEN_KEY);
        if (t) {
          await start(t);
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) signOutNow();
        else if (e instanceof ApiError && e.status === 0) {
          // No internet at start-up: show the last copy kept on this phone, read-only, and wait for the connection.
          try {
            const snap = JSON.parse((await AsyncStorage.getItem(SNAP_KEY)) ?? 'null') as { uid: string; db: DB } | null;
            const saved = snap?.db.users.find((u) => u.id === snap.uid);
            if (snap && saved) { signedIn.current = true; setMe(saved); setDb({ ...emptyDB(), ...snap.db }); setOnline(false); await readBox(saved.id); }
          } catch { /* no copy: the sign-in screen is shown */ }
        }
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep everyone's screen up to date (new payments, receipts, notices...).
  useEffect(() => {
    if (!me) return;
    const id = setInterval(async () => {
      try { const r = await api.get<MeResponse>('/me'); applyMe(r); if ((r.joinStatus ?? 'approved') === 'approved') await load(r.user); setOnline(true); await flushBox(); } catch (e) { if (e instanceof ApiError && e.status === 401) signOutNow(); else setOnline(false); }
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [me?.id, load, applyMe, flushBox]);

  const refresh = useCallback(async () => {
    try { const r = await api.get<MeResponse>('/me'); applyMe(r); if ((r.joinStatus ?? 'approved') === 'approved') await load(r.user); } catch { setOnline(false); }
  }, [load, applyMe]);

  // Runs an action, shows the server's message if it is refused, and refreshes the lists after success.
  const act = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    try { await fn(); await refresh(); return true; }
    catch (e) { Alert.alert('Not done', e instanceof Error ? e.message : 'Something went wrong.'); return false; }
  }, [refresh]);

  const requestOtp: Ctx['requestOtp'] = useCallback(async (phone) => {
    try { const r = await api.post<{ devCode?: string }>('/auth/request-otp', { phone }); return { ok: true, devCode: r.devCode }; }
    catch (e) { Alert.alert('Could not send the code', e instanceof Error ? e.message : 'Try again.'); return { ok: false }; }
  }, []);

  const verifyOtp: Ctx['verifyOtp'] = useCallback(async (phone, code, profile, churchNumber) => {
    try {
      const r = await api.post<{ token: string }>('/auth/verify', { phone, code, profile, churchNumber });
      await start(r.token);
      return 'ok';
    } catch (e) {
      // A person who is not yet bound to a church must give the church number first, then their details.
      if (e instanceof ApiError && e.status === 400 && /church number/i.test(e.message)) return 'needs-church';
      if (e instanceof ApiError && e.status === 400 && /profile/i.test(e.message)) return 'needs-profile';
      Alert.alert('Could not sign in', e instanceof Error ? e.message : 'Try again.');
      return 'error';
    }
  }, [start]);

  const lookup: Ctx['lookup'] = useCallback(async (phone, churchNumber) => {
    try { return await api.post<{ bound: boolean; church?: { name: string } | null }>('/auth/lookup', { phone, churchNumber }); }
    catch (e) { Alert.alert('Could not check', e instanceof Error ? e.message : 'Try again.'); return null; }
  }, []);

  const moveChurch: Ctx['moveChurch'] = useCallback(async (churchNumber, code, groups) => {
    try {
      const r = await api.post<{ token: string }>('/me/move', { churchNumber, code, groups });
      setDb(emptyDB()); // nothing from the old church stays on screen
      await start(r.token);
      return true;
    } catch (e) { Alert.alert('Could not move', e instanceof Error ? e.message : 'Try again.'); return false; }
  }, [start]);

  const value = useMemo<Ctx>(() => ({
    sandbox, enterSandbox,
    ready, online, db, me, church, settings, joinStatus, supportUnread, requestOtp, verifyOtp, lookup, moveChurch, signOut: () => {
      const n = outbox.queued.length;
      if (!n) { signOutNow(); return; }
      Alert.alert('Not sent yet', `${n} item(s) written without internet have not been sent. They stay on this phone for you, but will only be sent when you sign in again.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out anyway', style: 'destructive', onPress: signOutNow },
      ]);
    }, refresh,
    outbox, sendOutbox: async () => { const n = await flushBox(); if (n) await refresh(); return n; },
    hideRejected: async (key) => { const u = meRef.current; if (u) { await boxFor(u.id).hide(key); await readBox(u.id); } },
    add: async (c, data) => {
      if (!isQueueable(c)) return act(() => api.post(`/records/${c}`, data));
      const key = newKey();
      try { await api.post(`/records/${c}`, data, { 'X-Idempotency-Key': key }); await refresh(); return true; }
      catch (e) {
        if (e instanceof ApiError && e.status === 0 && meRef.current) {
          const saved = await boxFor(meRef.current.id).enqueue({ key, col: c, data, title: String(data.title ?? data.kind ?? c) });
          setOnline(false);
          if (!saved) { Alert.alert('Not saved', 'Too many things are waiting to be sent. Connect to the internet first.'); return false; }
          await readBox(meRef.current.id);
          Alert.alert('Saved on this phone', 'There is no internet. It will be sent automatically when you are back online.');
          return true;
        }
        Alert.alert('Not done', e instanceof Error ? e.message : 'Something went wrong.'); return false;
      }
    },
    campAction: (id, action, amount) => act(() => api.post(`/camp/registrations/${id}/action`, { action, amount })),
    archive: (c, id, reason) => act(() => api.post(`/records/${c}/${id}/archive`, { reason })),
    unarchive: (c, id) => act(() => api.post(`/records/${c}/${id}/restore`)),
    receivePayment: async (id) => {
      try { await api.post(`/payments/${id}/receive`, {}); await refresh(); return true; }
      catch (e) {
        // No internet: the Treasurer's confirmation waits on the phone. The server still checks M-Pesa when it is sent,
        // and refuses (with the reason) anything it cannot verify, so nothing is receipted without a check.
        if (e instanceof ApiError && e.status === 0 && meRef.current?.role === 'treasurer') {
          const p = db.payments.find((x) => x.id === id);
          const saved = await boxFor(meRef.current.id).enqueue({ key: ('ob-rcv-' + id).replace(/[^A-Za-z0-9_-]/g, '').padEnd(16, '0').slice(0, 64), col: 'payments', path: `/payments/${id}/receive`, data: {}, title: p ? `${p.memberName ?? ''} KSh ${p.amount}`.trim() : id });
          setOnline(false);
          if (!saved) { Alert.alert('Not saved', 'Too many things are waiting to be sent. Connect to the internet first.'); return false; }
          await readBox(meRef.current.id);
          Alert.alert('Saved on this phone', 'There is no internet. It will be sent automatically when you are back online.');
          return true;
        }
        // 412 = M-Pesa has not shown this payment (or shows a different amount). The Treasurer may still confirm after checking the statement.
        if (e instanceof ApiError && e.status === 412) {
          return new Promise<boolean>((resolve) => Alert.alert('Check before confirming', e.message, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'I have checked – confirm', onPress: async () => resolve(await act(() => api.post(`/payments/${id}/receive`, { confirmAnyway: true }))) },
          ]));
        }
        Alert.alert('Not done', e instanceof Error ? e.message : 'Something went wrong.');
        return false;
      }
    },
    receiveVerified: async () => {
      try { const r = await api.post<{ received: number; total: number; failed: number }>('/payments/receive-verified', {}); await refresh(); return r.received; }
      catch (e) { Alert.alert('Not done', e instanceof Error ? e.message : 'Something went wrong.'); return -1; }
    },
    approveNotice: (id) => act(() => api.post(`/notices/${id}/approve`)),
    decideMembership: (id, approve) => act(() => api.post(`/memberships/${id}/decide`, { approve })),
    decideRole: (userId, approve) => act(() => api.post(`/users/${userId}/role-decision`, { approve })),
    applyTransfer: (data) => act(() => api.post('/membership/apply', data)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ready, online, db, me, church, settings, joinStatus, supportUnread, requestOtp, verifyOtp, lookup, moveChurch, refresh, act, outbox, flushBox]);

  return <DBContext.Provider value={value}>{children}</DBContext.Provider>;
}
