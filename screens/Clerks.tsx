// Time-saving tools for the Treasurer, the Secretary and the Church Clerk:
//   Reconcile      – reconciliation and daily cash-up (Treasurer, Pastor)
//   RollScreen     – membership roll statistics and spreadsheet (Secretary, Clerk, Pastor, Elders)
//   RollActions    – change a member's roll status and issue letters (shown inside each membership card)
//   MinutesBuilder – write minutes or a meeting notice from a few fields (Secretary)
import React, { useEffect, useState } from 'react';
import { Share, Text } from 'react-native';
import { api, ApiError } from '../api';
import { Badge, Btn, C, Card, Chips, Empty, Field, H, P, Screen } from '../components/ui';
import { MINUTE_KINDS } from '../data/constants';
import { Alert, getLang, t as tt, tr } from '../i18n';
import { useNav } from '../nav';
import { ksh } from '../services/payments';
import { canIssueLetters, canManageMembership, canSeeReconciliation, canViewMembership, canWriteMinutes } from '../services/permissions';
import { composeMinutes, composeNotice, emptyMinutes } from '../services/minutes';
import { useDB } from '../store/db';
import { MembershipRecord } from '../types';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const kenyaNow = () => new Date(Date.now() + 3 * 3600e3);
const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400e3);

// ------------------------------------------------------------------ reconciliation and cash-up
interface Recon {
  from: string; to: string; csv: string; difference: number | null;
  receipted: { count: number; total: number; byCategory: Record<string, number> };
  waiting: { count: number; total: number; verified: number; mismatched: number };
  mpesa: { count: number; total: number; unclaimedCount: number; unclaimedTotal: number } | null;
}
const RANGES = ['Today', 'Last 7 days', 'This month', 'Last month'] as const;
type Range = (typeof RANGES)[number];
function rangeDates(r: Range): [string, string] {
  const n = kenyaNow(); const today = dayStr(n);
  if (r === 'Today') return [today, today];
  if (r === 'Last 7 days') return [dayStr(addDays(n, -6)), today];
  const first = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
  if (r === 'This month') return [dayStr(first), today];
  const lastFirst = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1));
  return [dayStr(lastFirst), dayStr(addDays(first, -1))];
}
export function Reconcile() {
  const { me } = useDB();
  const { back } = useNav();
  const [range, setRange] = useState<Range>('Today');
  const [data, setData] = useState<Recon | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true; const [from, to] = rangeDates(range);
    setBusy(true); setData(null);
    api.get<Recon>(`/finance/reconciliation?from=${from}&to=${to}`).then((d) => { if (live) setData(d); }).catch((e) => { if (live) Alert.alert('Not done', errText(e)); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [range]);
  if (!me || !canSeeReconciliation(me)) return <Screen title="Reconciliation & Cash-up" onBack={back}><Empty text="Only the Treasurer or Pastor can see this report." /></Screen>;
  return (
    <Screen title="Reconciliation & Cash-up" onBack={back}>
      <Chips options={RANGES} value={range} onChange={setRange} />
      {busy && <P mute>Loading…</P>}
      {data && (
        <>
          <Card>
            <H>Receipted</H>
            <P bold>{ksh(data.receipted.total)} · {tt('{0} receipts', data.receipted.count)}</P>
            {Object.entries(data.receipted.byCategory).map(([k, v]) => <P key={k} mute>{tr(k)}: {ksh(v)}</P>)}
          </Card>
          {data.mpesa && (
            <Card>
              <H>Reached the Pay Bill (M-Pesa)</H>
              <P bold>{ksh(data.mpesa.total)} · {tt('{0} payments', data.mpesa.count)}</P>
              {data.mpesa.unclaimedCount > 0 && <P>{tt('Not yet reported by any member: {0} payments, {1}', data.mpesa.unclaimedCount, ksh(data.mpesa.unclaimedTotal))}</P>}
              <P mute>{tt('Pay Bill minus receipted: {0}', ksh(data.difference ?? 0))}</P>
              <P mute>A difference is normal when a payment is receipted on a different day, or while payments are still waiting below.</P>
            </Card>
          )}
          <Card>
            <H>Still waiting to be receipted</H>
            <P bold>{tt('{0} payments, {1}', data.waiting.count, ksh(data.waiting.total))}</P>
            {data.waiting.verified > 0 && <Badge text={tt('{0} verified by M-Pesa: confirm them from Payments', data.waiting.verified)} color={C.ok} />}
            {data.waiting.mismatched > 0 && <Badge text={tt('{0} where the amount does not match M-Pesa', data.waiting.mismatched)} color={C.bad} />}
          </Card>
          <Btn label="Share spreadsheet (CSV)" onPress={() => Share.share({ message: data.csv, title: `cash-up-${data.from}-${data.to}.csv` })} />
        </>
      )}
    </Screen>
  );
}

// ------------------------------------------------------------------ the roll: statistics and spreadsheet
interface Roll { count: number; csv: string; stats: { onRoll: number; byStatus: Record<string, number>; baptismsByYear: Record<string, number>; transfersInByYear: Record<string, number>; transfersOutByYear: Record<string, number>; deathsByYear: Record<string, number> } }
const STATUS_LABEL: Record<string, string> = { active: 'Active member', inactive: 'Inactive', transferred_out: 'Moved to another church', deceased: 'Deceased', application: 'Awaiting Church Board', declined: 'Declined' };
const yearRows = (m: Record<string, number>) => Object.keys(m).sort().reverse().map((y) => `${y}: ${m[y]}`).join('   ') || '—';
export function RollScreen() {
  const { me } = useDB();
  const { back } = useNav();
  const [data, setData] = useState<Roll | null>(null);
  useEffect(() => { if (me && canViewMembership(me)) api.get<Roll>('/membership/roll').then(setData).catch((e) => Alert.alert('Not done', errText(e))); }, [me?.id]);
  if (!me || !canViewMembership(me)) return <Screen title="Membership Roll" onBack={back}><Empty text="Membership records are kept by the Secretary and Clerk." /></Screen>;
  return (
    <Screen title="Membership Roll" onBack={back}>
      {data ? (
        <>
          <Card><P mute>Members on the roll</P><H>{data.stats.onRoll}</H>
            {Object.entries(data.stats.byStatus).filter(([k]) => k !== 'active').map(([k, v]) => <P key={k} mute>{tr(STATUS_LABEL[k] ?? k)}: {v}</P>)}</Card>
          <Card><H>By year</H>
            <P>{tr('Baptisms')}: {yearRows(data.stats.baptismsByYear)}</P>
            <P>{tr('Transfers received')}: {yearRows(data.stats.transfersInByYear)}</P>
            <P>{tr('Moved to another church')}: {yearRows(data.stats.transfersOutByYear)}</P>
            <P>{tr('Deceased')}: {yearRows(data.stats.deathsByYear)}</P></Card>
          <Btn label="Share spreadsheet (CSV)" onPress={() => Share.share({ message: data.csv, title: 'membership-roll.csv' })} />
        </>
      ) : <P mute>Loading…</P>}
    </Screen>
  );
}

// ------------------------------------------------------------------ change a member's status and issue letters
type RollStatus = 'active' | 'inactive' | 'transferred_out' | 'deceased';
export function RollActions({ m }: { m: MembershipRecord }) {
  const { me, refresh } = useDB();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<RollStatus | ''>('');
  const [dest, setDest] = useState(m.statusDestination ?? '');
  const [note, setNote] = useState('');
  const onRoll = ['active', 'inactive', 'transferred_out', 'deceased'].includes(m.status);
  if (!me || !onRoll || !(canManageMembership(me) || canIssueLetters(me))) return null;
  const options = (['active', 'inactive', 'transferred_out', 'deceased'] as RollStatus[]).filter((s) => s !== m.status);
  const save = async () => {
    if (!to) return Alert.alert('Missing', 'Choose a status.');
    try { await api.post(`/memberships/${m.id}/status`, { status: to, destination: dest, note }); await refresh(); setOpen(false); setTo(''); setNote(''); }
    catch (e) { Alert.alert('Not done', errText(e)); }
  };
  const letter = async (type: 'baptism' | 'membership' | 'transfer') => {
    try {
      const r = await api.get<{ ref: string; text: string }>(`/membership/${m.id}/letter?type=${type}&lang=${getLang()}&destination=${encodeURIComponent(dest)}`);
      await Share.share({ message: r.text, title: r.ref });
    } catch (e) { Alert.alert('Not done', errText(e)); }
  };
  return (
    <>
      <Btn kind="ghost" small label={open ? 'Hide roll actions' : 'Roll actions and letters'} onPress={() => setOpen(!open)} />
      {open && (
        <Card style={{ backgroundColor: '#F3F6FA' }}>
          {canManageMembership(me) && (
            <>
              <H>Change status</H>
              <Chips options={options} value={to as RollStatus} onChange={setTo} labels={{ active: tr('Back to active'), inactive: tr('Inactive'), transferred_out: tr('Moved to another church'), deceased: tr('Deceased') }} />
              {to === 'transferred_out' && <Field label="Moving to (church)" value={dest} onChangeText={setDest} />}
              <Field label="Note (optional)" value={note} onChangeText={setNote} />
              <Btn small label="Save status" onPress={save} />
              {m.statusHistory?.length ? m.statusHistory.map((h, i) => <P key={i} mute>{h.date}: {tr(STATUS_LABEL[h.from] ?? h.from)} → {tr(STATUS_LABEL[h.to] ?? h.to)} ({h.by}){h.destination ? ' · ' + h.destination : ''}</P>) : null}
            </>
          )}
          {canIssueLetters(me) && (
            <>
              <H>Letters</H>
              <P mute>Each letter gets its own reference number and is written to the audit trail.</P>
              {m.entry === 'baptism' && m.baptismDate ? <Btn small kind="ghost" label="Baptism certificate" onPress={() => letter('baptism')} /> : null}
              {m.status === 'active' && <Btn small kind="ghost" label="Letter of membership" onPress={() => letter('membership')} />}
              {(m.status === 'active' || m.status === 'transferred_out') && (
                <>
                  <Field label="Moving to (church)" value={dest} onChangeText={setDest} />
                  <Btn small kind="ghost" label="Transfer letter" onPress={() => letter('transfer')} />
                </>
              )}
            </>
          )}
        </Card>
      )}
    </>
  );
}

// ------------------------------------------------------------------ minutes and meeting notices from a few fields
export function MinutesBuilder() {
  const { me, add } = useDB();
  const { back } = useNav();
  const sw = getLang() === 'sw';
  const [mode, setMode] = useState<'minutes' | 'notice'>('minutes');
  const [f, setF] = useState({ ...emptyMinutes(), kind: MINUTE_KINDS[0], date: dayStr(kenyaNow()), secretary: me?.name ?? '' });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  if (!me || !canWriteMinutes(me)) return <Screen title="Minutes Builder" onBack={back}><Empty text="Minutes are kept by the Church Secretary. You have read access." /></Screen>;
  const m = composeMinutes(f, sw);
  const n = composeNotice(f, sw, mode === 'minutes');
  const post = async (notice: { title: string; body: string }) => { if (await add('notices', { board: 'church', title: notice.title, body: notice.body })) Alert.alert('Posted', 'The notice is on the church notice board.'); };
  return (
    <Screen title="Minutes Builder" onBack={back}>
      <Chips options={['minutes', 'notice'] as const} value={mode} onChange={setMode} labels={{ minutes: tr('Write minutes'), notice: tr('Notice of a meeting') }} />
      <Card>
        <Chips options={MINUTE_KINDS} value={f.kind} onChange={set('kind')} />
        <Field label={mode === 'minutes' ? 'Meeting date (YYYY-MM-DD)' : 'Date of the meeting (YYYY-MM-DD)'} value={f.date} onChangeText={set('date')} />
        <Field label="Time" value={f.time} onChangeText={set('time')} />
        <Field label="Venue" value={f.venue} onChangeText={set('venue')} />
        {mode === 'minutes' && (
          <>
            <Field label="Chair" value={f.chair} onChangeText={set('chair')} />
            <Field label="Secretary" value={f.secretary} onChangeText={set('secretary')} />
            <Field label="Present (number or names)" value={f.present} onChangeText={set('present')} />
            <Field label="Apologies" value={f.apologies} onChangeText={set('apologies')} />
          </>
        )}
        <Field label="Agenda (one item per line)" value={f.agenda} onChangeText={set('agenda')} multiline />
        {mode === 'minutes' && (
          <>
            <Field label="Resolutions (one per line)" value={f.resolutions} onChangeText={set('resolutions')} multiline />
            <Field label="Action items (task – person – date, one per line)" value={f.actions} onChangeText={set('actions')} multiline />
            <Field label="Next meeting date (YYYY-MM-DD)" value={f.nextDate} onChangeText={set('nextDate')} />
            <Field label="Next meeting time" value={f.nextTime} onChangeText={set('nextTime')} />
          </>
        )}
      </Card>
      <Card><H>Preview</H><Text style={{ color: C.ink }}>{mode === 'minutes' ? m.body : n.body}</Text></Card>
      {mode === 'minutes' ? (
        <>
          <Btn label="Save minutes to vault" onPress={async () => { if (!f.date.trim()) return Alert.alert('Missing', 'Add a title and the minutes.'); if (await add('minutes', { kind: f.kind, title: m.title, meetingDate: f.date, body: m.body })) Alert.alert('Saved', 'The minutes are in the Minute Vault.'); }} />
          {f.nextDate.trim() ? <Btn kind="ghost" label="Post notice of the next meeting" onPress={() => post(n)} /> : null}
        </>
      ) : <Btn label="Post notice to the church board" onPress={() => post(n)} />}
      <Btn kind="ghost" label="Share" onPress={() => Share.share({ message: mode === 'minutes' ? m.body : n.body, title: mode === 'minutes' ? m.title : n.title })} />
    </Screen>
  );
}
export { ApiError };
