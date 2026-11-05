import React, { useState } from 'react';
import { Text } from 'react-native';
import { Alert, t as tt, tr } from '../i18n';
import { Badge, Btn, C, Card, Chips, Empty, Field, H, P, Screen } from '../components/ui';
import { LEADER_ROLES, MINUTE_KINDS, WELFARE_FUNDS, roleLabel } from '../data/constants';
import { useNav } from '../nav';
import { RollActions } from './Clerks';
import { ksh } from '../services/payments';
import {
  canDecideTransfer, canManageMembership, canManageProject, canManageWelfare, canReadMinutes, canViewMembership, canWriteMinutes,
} from '../services/permissions';
import { useDB } from '../store/db';
import { CollectionName, MemberEntry, OfficeRecord, WelfareFund } from '../types';

const ArchiveBtn = ({ col, id }: { col: CollectionName; id: string }) => {
  const { me, archive } = useDB();
  if (!me) return null;
  return <Btn kind="ghost" small label="Archive" onPress={() => archive(col, id)} />;
};

// ---------------- Membership ----------------
export function Membership() {
  const { me, db, add, decideMembership } = useDB();
  const { back, go } = useNav();
  const [entry, setEntry] = useState<MemberEntry>('baptism');
  const [f, setF] = useState({ fullName: '', idNumber: '', phone: '', baptismDate: '', fromChurch: '', transferLetterRef: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));
  if (!me || !canViewMembership(me)) return <Screen title="Membership" onBack={back}><Empty text="Membership records are kept by the Secretary and Clerk." /></Screen>;
  const list = db.memberships.filter((m) => !m.archived).slice().reverse();

  const submit = async () => {
    if (!f.fullName.trim()) return Alert.alert('Missing', 'Enter the full name.');
    // The server assigns the member number (baptism) or starts the Church Board application (transfer).
    const ok = entry === 'baptism'
      ? await add('memberships', { fullName: f.fullName.trim(), idNumber: f.idNumber, phone: f.phone, entry, baptismDate: f.baptismDate })
      : await add('memberships', { fullName: f.fullName.trim(), idNumber: f.idNumber, phone: f.phone, entry, fromChurch: f.fromChurch, transferLetterRef: f.transferLetterRef });
    if (!ok) return;
    if (entry === 'transfer') Alert.alert('Submitted', 'The transfer application was sent to the Church Board.');
    setF({ fullName: '', idNumber: '', phone: '', baptismDate: '', fromChurch: '', transferLetterRef: '' });
  };

  return (
    <Screen title="Church Membership" onBack={back}>
      {canManageMembership(me) && (
        <Card>
          <H>Add / receive a member</H>
          <Chips options={['baptism', 'transfer'] as const} value={entry} onChange={setEntry} labels={{ baptism: 'By baptism', transfer: 'By transfer' }} />
          <Field label="Full name" value={f.fullName} onChangeText={set('fullName')} />
          <Field label="ID number" value={f.idNumber} onChangeText={set('idNumber')} />
          <Field label="Phone" value={f.phone} onChangeText={set('phone')} />
          {entry === 'baptism'
            ? <Field label="Baptism date (YYYY-MM-DD)" value={f.baptismDate} onChangeText={set('baptismDate')} />
            : (<><Field label="Coming from (church)" value={f.fromChurch} onChangeText={set('fromChurch')} /><Field label="Transfer letter reference" value={f.transferLetterRef} onChangeText={set('transferLetterRef')} /></>)}
          <Btn label={entry === 'baptism' ? 'Add to membership list' : 'Submit application to Church Board'} onPress={submit} />
        </Card>
      )}
      <Btn kind="ghost" label="Membership roll: statistics and spreadsheet" onPress={() => go('roll')} />
      {list.length ? list.map((m) => (
        <Card key={m.id}>
          <Badge text={({ application: 'Awaiting Church Board', declined: 'Declined', inactive: 'Inactive', transferred_out: 'Moved to another church', deceased: 'Deceased' } as Record<string, string>)[m.status] ?? 'Active member'} color={m.status === 'active' ? C.ok : m.status === 'application' ? C.warn : C.mute} />
          <H>{m.fullName}{m.memberNumber ? '  ' + m.memberNumber : ''}</H>
          <P mute>ID {m.idNumber} · {m.phone}</P>
          <P>{m.entry === 'baptism' ? tt('Baptised: {0}', m.baptismDate || '—') : tt('Transfer from {0} · letter {1}', m.fromChurch || '—', m.transferLetterRef || '—')}</P>
          {m.status === 'application' && canDecideTransfer(me) && (
            <>
              <Btn kind="ok" small label="Approve (Church Board)" onPress={() => decideMembership(m.id, true)} />
              <Btn kind="danger" small label="Decline" onPress={() => decideMembership(m.id, false)} />
            </>
          )}
          <RollActions m={m} />
          {canManageMembership(me) && <ArchiveBtn col="memberships" id={m.id} />}
        </Card>
      )) : <Empty text="No records yet." />}
    </Screen>
  );
}

// ---------------- Welfare ----------------
export function Welfare() {
  const { me, db, add } = useDB();
  const { back } = useNav();
  const [fund, setFund] = useState<WelfareFund>(WELFARE_FUNDS[0]);
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  if (!me) return null;
  const list = db.welfare.filter((w) => w.fund === fund && !w.archived).slice().reverse();
  const total = list.reduce((s, w) => s + w.amount, 0);
  return (
    <Screen title="Welfare" onBack={back}>
      <Chips options={WELFARE_FUNDS} value={fund} onChange={setFund} />
      <Card><P mute>{fund}</P><H>{ksh(total)}</H></Card>
      {canManageWelfare(me) ? (
        <Card>
          <H>Add entry</H>
          <Field label="Description / contributor / family" value={title} onChangeText={setTitle} />
          <Field label="Amount (KSh)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Note" value={note} onChangeText={setNote} multiline />
          <Btn label="Record" onPress={async () => {
            if (!title.trim()) return Alert.alert('Missing', 'Add a description.');
            if (await add('welfare', { fund, kind: 'contribution', title: title.trim(), amount: Number(amount) || 0, note })) { setTitle(''); setAmount(''); setNote(''); }
          }} />
        </Card>
      ) : <P mute>Give to welfare funds from the Give screen (choose Welfare / Benevolent).</P>}
      {list.length ? list.map((w) => (
        <Card key={w.id}><H>{w.title}</H><P bold>{ksh(w.amount)}</P><P mute>{w.note}</P>{canManageWelfare(me) && <ArchiveBtn col="welfare" id={w.id} />}</Card>
      )) : <Empty text="No entries in this fund." />}
    </Screen>
  );
}

// ---------------- Church building project ----------------
export function Project() {
  const { me, db, add } = useDB();
  const { back } = useNav();
  const [kind, setKind] = useState<'contribution' | 'expense' | 'update'>('contribution');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  if (!me) return null;
  const list = db.projects.filter((p) => !p.archived).slice().reverse();
  const raised = list.filter((p) => p.kind === 'contribution').reduce((s, p) => s + p.amount, 0);
  const spent = list.filter((p) => p.kind === 'expense').reduce((s, p) => s + p.amount, 0);
  return (
    <Screen title="Church Building Project" onBack={back}>
      <Card><P mute>Raised {ksh(raised)} · Spent {ksh(spent)}</P><H>Balance {ksh(raised - spent)}</H></Card>
      {canManageProject(me) && (
        <Card>
          <H>Add entry</H>
          <Chips options={['contribution', 'expense', 'update'] as const} value={kind} onChange={setKind} />
          <Field label="Description" value={title} onChangeText={setTitle} />
          <Field label="Amount (KSh)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Note" value={note} onChangeText={setNote} multiline />
          <Btn label="Record" onPress={async () => {
            if (!title.trim()) return Alert.alert('Missing', 'Add a description.');
            if (await add('projects', { project: 'Church Building', kind, title: title.trim(), amount: Number(amount) || 0, note })) { setTitle(''); setAmount(''); setNote(''); }
          }} />
        </Card>
      )}
      {list.length ? list.map((p) => (
        <Card key={p.id}><Badge text={p.kind} /><H>{p.title}</H>{p.amount ? <P bold>{ksh(p.amount)}</P> : null}<P mute>{p.note}</P>{canManageProject(me) && <ArchiveBtn col="projects" id={p.id} />}</Card>
      )) : <Empty text="No entries yet." />}
    </Screen>
  );
}

// ---------------- Minute vault ----------------
export function Minutes() {
  const { me, db, add } = useDB();
  const { back, go } = useNav();
  const [kind, setKind] = useState(MINUTE_KINDS[0]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [body, setBody] = useState('');
  if (!me || !canReadMinutes(me)) return <Screen title="Minute Vault" onBack={back}><Empty text="The Minute Vault is kept by the Church Secretary." /></Screen>;
  const list = db.minutes.filter((m) => !m.archived).slice().reverse();
  return (
    <Screen title="Minute Vault" onBack={back}>
      {canWriteMinutes(me) ? (
        <Card>
          <Btn kind="ghost" label="📝 Minutes Builder: write minutes or a meeting notice from a few fields" onPress={() => go('minutesBuilder')} />
          <H>Add minutes</H>
          <Chips options={MINUTE_KINDS} value={kind} onChange={setKind} />
          <Field label="Title" value={title} onChangeText={setTitle} />
          <Field label="Meeting date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
          <Field label="Minutes" value={body} onChangeText={setBody} multiline />
          <Btn label="Save to vault" onPress={async () => {
            if (!title.trim() || !body.trim()) return Alert.alert('Missing', 'Add a title and the minutes.');
            if (await add('minutes', { kind, title: title.trim(), meetingDate: date, body })) { setTitle(''); setDate(''); setBody(''); }
          }} />
        </Card>
      ) : <P mute>Minutes are kept by the Church Secretary. You have read access.</P>}
      {list.length ? list.map((m) => (
        <Card key={m.id}><Badge text={m.kind} /><H>{m.title}</H><P mute>Meeting: {m.meetingDate}</P><P>{m.body}</P>{canWriteMinutes(me) && <ArchiveBtn col="minutes" id={m.id} />}</Card>
      )) : <Empty text="The vault is empty." />}
    </Screen>
  );
}

// ---------------- Archive & audit ----------------
const COLS: CollectionName[] = ['notices', 'minutes', 'memberships', 'welfare', 'projects', 'care', 'activities', 'office', 'payments'];
export function ArchiveScreen() {
  const { me, db, unarchive } = useDB();
  const { back } = useNav();
  if (!me) return null;
  const canRestore = me.role === 'secretary' || me.role === 'pastor';
  const items = COLS.flatMap((c) => (db[c] as unknown as { id: string; archived: boolean; archivedAt?: string; archivedBy?: string; title?: string; fullName?: string; purpose?: string }[])
    .filter((r) => r.archived).map((r) => ({ c, r })))
    .sort((a, b) => ((a.r.archivedAt ?? '') < (b.r.archivedAt ?? '') ? 1 : -1));
  return (
    <Screen title="Archive & Audit" onBack={back}>
      <Card><H>Archived records</H><P mute>Archived items are never deleted. They are hidden from daily lists and can be restored.</P></Card>
      {items.length ? items.map(({ c, r }) => (
        <Card key={c + r.id}><Badge text={c} /><P bold>{r.title ?? r.fullName ?? r.purpose ?? 'Record'}</P><P mute>Archived {r.archivedAt ? new Date(r.archivedAt).toLocaleString() : ''}</P>
          {canRestore && <Btn kind="ghost" small label="Restore" onPress={() => unarchive(c, r.id)} />}</Card>
      )) : <Empty text="Nothing archived yet." />}
      <Card>
        <H>Audit trail (latest 20)</H>
        {db.audit.slice(-20).reverse().map((a) => <Text key={a.id} style={{ color: C.mute, fontSize: 12, marginBottom: 2 }}>{new Date(a.at).toLocaleString()} · {a.action} {a.col}</Text>)}
      </Card>
    </Screen>
  );
}

// ---------------- Verify leader positions (Secretary / Pastor) ----------------
export function RoleApprovals() {
  const { me, db, decideRole } = useDB();
  const { back } = useNav();
  if (!me || (me.role !== 'secretary' && me.role !== 'pastor')) return <Screen title="Verify Positions" onBack={back}><Empty text="Only the Church Secretary or Pastor verifies leader positions." /></Screen>;
  return (
    <Screen title="Verify Leader Positions" onBack={back}>
      <Card><P mute>People who ask for a leader position act as members until you approve it. Check with the church before approving.</P></Card>
      {db.pendingRoles.length ? db.pendingRoles.map((u) => (
        <Card key={u.id}>
          <H>{u.name}</H>
          <P mute>{u.phone} · {u.church}</P>
          <P>{tr('Requests:')} <Text style={{ fontWeight: '700' }}>{roleLabel(u.requestedRole)}</Text></P>
          <Btn kind="ok" small label="Approve position" onPress={() => decideRole(u.id, true)} />
          <Btn kind="danger" small label="Decline" onPress={() => decideRole(u.id, false)} />
        </Card>
      )) : <Empty text="No requests waiting." />}
    </Screen>
  );
}

// ---------------- A member applies for transfer ----------------
export function TransferApply() {
  const { me, db, applyTransfer } = useDB();
  const { back } = useNav();
  const [fromChurch, setFromChurch] = useState('');
  const [letter, setLetter] = useState('');
  const [note, setNote] = useState('');
  if (!me) return null;
  const mine = db.memberships.filter((m) => m.createdBy === me.id && m.applicantId === me.id && !m.archived).slice().reverse();
  const waiting = mine.some((m) => m.status === 'application');
  return (
    <Screen title="Join by Transfer" onBack={back}>
      <Card>
        <H>Apply to the Church Board</H>
        <P mute>If you are moving from another Seventh-day Adventist church, apply here. Your application goes to the Church Board, led by the Pastor. Bring your transfer letter to the Church Clerk.</P>
      </Card>
      {mine.map((m) => (
        <Card key={m.id}>
          <Badge text={m.status === 'application' ? 'Waiting for the Church Board' : m.status === 'declined' ? 'Not approved' : 'Approved'} color={m.status === 'active' ? C.ok : m.status === 'declined' ? C.mute : C.warn} />
          <P bold>From {m.fromChurch}</P>
          {m.memberNumber ? <P>{tr('Your membership number:')} <Text style={{ fontWeight: '700' }}>{m.memberNumber}</Text></P> : null}
          {m.status === 'declined' ? <P mute>Please speak to the Pastor or Church Clerk.</P> : null}
        </Card>
      ))}
      {!waiting && (
        <Card>
          <H>New application</H>
          <Field label="Church you are coming from" value={fromChurch} onChangeText={setFromChurch} />
          <Field label="Transfer letter reference (if you have it)" value={letter} onChangeText={setLetter} />
          <Field label="Anything the Board should know" value={note} onChangeText={setNote} multiline />
          <Btn label="Submit to Church Board" onPress={async () => {
            if (!fromChurch.trim()) return Alert.alert('Missing', 'Say which church you are coming from.');
            if (await applyTransfer({ fromChurch: fromChurch.trim(), transferLetterRef: letter.trim(), note: note.trim() })) {
              setFromChurch(''); setLetter(''); setNote('');
              Alert.alert('Submitted', 'Your application was sent to the Church Board.');
            }
          }} />
        </Card>
      )}
    </Screen>
  );
}

// ---------------- Office records: reports, plans and minutes each leader keeps for their own office ----------------
const OFFICE_KINDS: OfficeRecord['kind'][] = ['report', 'plan', 'minutes', 'other'];
const KIND_LABEL: Record<string, string> = { report: 'Report', plan: 'Plan', minutes: 'Minutes', other: 'Other' };
export function OfficeRecords() {
  const { me, db, add } = useDB();
  const { back } = useNav();
  const [kind, setKind] = useState<OfficeRecord['kind']>('report');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [body, setBody] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);
  if (!me) return null;
  const overseer = me.role === 'pastor' || me.role === 'secretary'; // they may read every office
  const office = viewing ?? me.role;
  const own = office === me.role;
  const list = db.office.filter((o) => o.office === office && !o.archived && !['attendance', 'pledge', 'pledge_payment'].includes(o.kind)).slice().reverse(); // the register and pledges have their own screens
  const offices = LEADER_ROLES.map((r) => r.key);
  return (
    <Screen title="Office Records" onBack={back}>
      {overseer && (
        <Card>
          <H>View another office</H>
          <Chips options={offices} value={office} onChange={(v) => setViewing(v === me.role ? null : v)} labels={Object.fromEntries(LEADER_ROLES.map((r) => [r.key, tr(r.label)]))} />
        </Card>
      )}
      <Card><P mute>{tt('Records for: {0}', roleLabel(office))}</P></Card>
      {own && (
        <Card>
          <H>Add a record</H>
          <Chips options={OFFICE_KINDS} value={kind} onChange={setKind} labels={KIND_LABEL} />
          <Field label="Title" value={title} onChangeText={setTitle} />
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
          <Field label="Details" value={body} onChangeText={setBody} multiline />
          <Btn label="Save record" onPress={async () => {
            if (!title.trim() || !body.trim()) return Alert.alert('Missing', 'Add a title and the details.');
            if (await add('office', { office: me.role, kind, title: title.trim(), date, body })) { setTitle(''); setDate(''); setBody(''); }
          }} />
        </Card>
      )}
      {list.length ? list.map((o) => (
        <Card key={o.id}><Badge text={KIND_LABEL[o.kind] ?? o.kind} /><H>{o.title}</H><P mute>{o.date}</P><P>{o.body}</P>{own && <ArchiveBtn col="office" id={o.id} />}</Card>
      )) : <Empty text="No records yet." />}
    </Screen>
  );
}
