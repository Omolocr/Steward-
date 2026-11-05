// The Church Admin console, the "waiting to join" page, "move to another church", and the direct-line chat widget.
// Nothing here deletes anything: "delete" a member or an activity means ARCHIVE (it can be restored, and the history is kept).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { api } from '../api';
import { Badge, Btn, C, Card, Chips, Empty, Field, H, P, Row, Screen, Toggle } from '../components/ui';
import { GROUPS, LEADER_ROLES, roleLabel } from '../data/constants';
import { Alert, getLang, t as tt, tr } from '../i18n';
import { useNav } from '../nav';
import { useDB } from '../store/db';
import { AdminOverview, ChurchSettings, Member, SupportMessage } from '../types';

const roleLabels = Object.fromEntries(LEADER_ROLES.map((r) => [r.key, r.label])) as Record<string, string>;
const groupLabels = Object.fromEntries(GROUPS.map((g) => [g.key, g.label])) as Record<string, string>;
const toggle = (list: string[], set: (l: string[]) => void) => (k: string) => set(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

// ---------------------------------------------------------------- opening the chat from anywhere
const openers = new Set<() => void>();
export const openSupport = () => openers.forEach((f) => f());

// ---------------------------------------------------------------- Church Admin dashboard
export function AdminConsole() {
  const { me, church, db } = useDB();
  const { go, back } = useNav();
  const [ov, setOv] = useState<AdminOverview | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setOv(await api.get<AdminOverview>('/admin/overview')); setErr(''); } catch (e) { setErr(errText(e)); } }, []);
  useEffect(() => { load(); }, [load, db.users.length]);
  if (!me || me.role !== 'church_admin') return <Screen title="Church Admin" onBack={back}><Empty text="Only the Church Admin can open this page." /></Screen>;
  const c = ov?.counts;
  return (
    <Screen title="Church Admin" onBack={back}>
      <Card style={{ backgroundColor: C.primary }}>
        <Text style={{ color: '#DBE8F5', fontSize: 12 }}>{tr('Your church')}</Text>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>{ov?.church.name ?? church?.name ?? ''}</Text>
        <Text style={{ color: '#DBE8F5', fontSize: 12, marginTop: 8 }}>{tr('Special church number')}</Text>
        <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 3 }}>{ov?.church.number ?? church?.number ?? '…'}</Text>
        <Text style={{ color: '#DBE8F5', fontSize: 12, marginTop: 6 }}>{tr('Members enter this number when they sign up or move to your church. It is given by the app developer.')}</Text>
      </Card>
      {!!err && <Card><P>{err}</P></Card>}
      {!!c && (
        <Card>
          <H>At a glance</H>
          <Row style={{ flexWrap: 'wrap' }}>
            <Badge text={tt('{0} members', c.members)} />
            {c.waitingToJoin > 0 && <Badge color={C.warn} text={tt('{0} waiting to join', c.waitingToJoin)} />}
            {c.rolesToVerify > 0 && <Badge color={C.warn} text={tt('{0} positions to verify', c.rolesToVerify)} />}
            <Badge color={C.mute} text={tt('{0} archived', c.archivedMembers)} />
          </Row>
        </Card>
      )}
      <Btn label={c && c.waitingToJoin ? tt('Members ({0} waiting)', c.waitingToJoin) : 'Members'} onPress={() => go('adminMembers')} />
      <Btn kind="ghost" label="Export, import & directory" onPress={() => go('adminBulk')} />
      <Btn kind="ghost" label={c && c.rolesToVerify ? tt('Verify Leader Positions ({0})', c.rolesToVerify) : 'Verify Leader Positions'} onPress={() => go('roles')} />
      <Btn kind="ghost" label="Church settings (Pay Bill, giving categories)" onPress={() => go('adminSettings')} />
      <Btn kind="ghost" label="Church calendar & activities" onPress={() => go('activities', { g: 'church' })} />
      <Btn kind="ghost" label="Church Notice Board" onPress={() => go('church')} />
      <Btn kind="ghost" label="Archive & Audit" onPress={() => go('archive')} />
      <Btn kind="ok" label={ov && ov.supportUnread ? tt('Talk to the app developer ({0} new)', ov.supportUnread) : 'Talk to the app developer'} onPress={openSupport} />
      <Text style={{ color: C.mute, fontSize: 12, textAlign: 'center', marginTop: 8 }}>{tr('Nothing is ever deleted: removing a member or an activity archives it, and it can be restored.')}</Text>
    </Screen>
  );
}

// ---------------------------------------------------------------- members
export function AdminMembers() {
  const { me, refresh } = useDB();
  const { back } = useNav();
  const [list, setList] = useState<Member[]>([]);
  const [tab, setTab] = useState<'Active' | 'Waiting' | 'Archived'>('Active');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [role, setRole] = useState('member');
  const [nm, setNm] = useState(''); const [ph, setPh] = useState(''); const [idn, setIdn] = useState('');
  const [aRole, setARole] = useState('member'); const [aGroups, setAGroups] = useState<string[]>([]);

  const load = useCallback(async () => { try { setList((await api.get<{ members: Member[] }>('/admin/members?archived=1')).members); } catch (e) { Alert.alert('Not loaded', errText(e)); } }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); await refresh(); return true; } catch (e) { Alert.alert('Not done', errText(e)); return false; } };

  const active = list.filter((m) => !m.archived && m.joinStatus === 'approved');
  const waiting = list.filter((m) => !m.archived && m.joinStatus === 'pending');
  const archived = list.filter((m) => m.archived);
  const shown = tab === 'Active' ? active : tab === 'Waiting' ? waiting : archived;
  if (!me) return null;

  return (
    <Screen title="Members" onBack={back}>
      <Chips options={['Active', 'Waiting', 'Archived'] as const} value={tab} onChange={setTab} labels={{ Active: tt('Active ({0})', active.length), Waiting: tt('Waiting to join ({0})', waiting.length), Archived: tt('Archived ({0})', archived.length) }} />
      <Btn kind="ghost" label={showAdd ? 'Close' : '+ Add a member'} onPress={() => setShowAdd(!showAdd)} />
      {showAdd && (
        <Card>
          <H>Add a member</H>
          <P mute>They sign in later with this phone number. They do not need a church number because they are already linked to your church.</P>
          <Field label="Full name" value={nm} onChangeText={setNm} />
          <Field label="Phone number" value={ph} onChangeText={setPh} keyboardType="phone-pad" placeholder="07XXXXXXXX" />
          <Field label="ID number (optional)" value={idn} onChangeText={setIdn} keyboardType="number-pad" />
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 4 }}>{tr('Position')}</Text>
          <Chips options={['member', 'former_leader', ...LEADER_ROLES.map((r) => r.key)]} value={aRole} onChange={setARole} labels={{ member: 'Member', former_leader: 'Former Leader (Advisor)', ...roleLabels }} />
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 4 }}>{tr('Groups')}</Text>
          <Chips options={GROUPS.map((g) => g.key)} value={aGroups} onChange={toggle(aGroups, setAGroups)} labels={groupLabels} />
          <Btn label="Add member" onPress={async () => {
            if (nm.trim().length < 2 || !ph.trim()) return Alert.alert('Missing details', 'Please write the name and the phone number.');
            if (await run(() => api.post('/admin/members', { name: nm.trim(), phone: ph.trim(), idNumber: idn.trim(), role: aRole, groups: aGroups }))) { setNm(''); setPh(''); setIdn(''); setARole('member'); setAGroups([]); setShowAdd(false); }
          }} />
        </Card>
      )}
      {shown.length === 0 ? <Empty text={tab === 'Waiting' ? 'Nobody is waiting to join.' : tab === 'Archived' ? 'No archived members.' : 'No members yet.'} /> : shown.map((m) => (
        <Card key={m.id}>
          <Row style={{ justifyContent: 'space-between' }}><H>{m.name}</H><Badge text={roleLabel(m.role)} color={m.role === 'member' ? C.mute : C.primary} /></Row>
          <P mute>{m.phone}{m.groups.length ? ' · ' + m.groups.map((g) => tr(groupLabels[g] ?? g)).join(', ') : ''}</P>
          {m.roleStatus === 'pending' && <P>{tt('Asked for: {0} (not yet verified)', roleLabel(m.requestedRole))}</P>}
          {tab === 'Waiting' && <Row style={{ marginTop: 8 }}>
            <Btn small kind="ok" label="Let in" onPress={() => run(() => api.post(`/admin/members/${m.id}/join`, { approve: true }))} />
            <Btn small kind="ghost" label="Decline" onPress={() => run(() => api.post(`/admin/members/${m.id}/join`, { approve: false }))} />
          </Row>}
          {tab === 'Active' && m.id !== me.id && (editing === m.id ? (
            <View style={{ marginTop: 8 }}>
              <Chips options={['member', 'former_leader', ...LEADER_ROLES.map((r) => r.key)]} value={role} onChange={setRole} labels={{ member: 'Member', former_leader: 'Former Leader (Advisor)', ...roleLabels }} />
              <Row>
                <Btn small label="Save position" onPress={async () => { if (await run(() => api.post(`/admin/members/${m.id}/role`, { role }))) setEditing(null); }} />
                <Btn small kind="ghost" label="Cancel" onPress={() => setEditing(null)} />
              </Row>
            </View>
          ) : (
            <Row style={{ marginTop: 8 }}>
              <Btn small kind="ghost" label="Change position" onPress={() => { setRole(m.role); setEditing(m.id); }} />
              <Btn small kind="danger" label="Archive" onPress={() => Alert.alert('Archive this member?', tt('{0} will lose access to the church pages. Their records stay, and you can restore them later.', m.name), [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Archive', style: 'destructive', onPress: () => { run(() => api.post(`/admin/members/${m.id}/archive`, { reason: 'archived by church admin' })); } },
              ])} />
            </Row>
          ))}
          {tab === 'Archived' && <View style={{ marginTop: 8 }}><Btn small kind="ghost" label="Restore" onPress={() => run(() => api.post(`/admin/members/${m.id}/restore`))} /></View>}
        </Card>
      ))}
    </Screen>
  );
}

// ---------------------------------------------------------------- settings
export function AdminSettings() {
  const { settings, refresh } = useDB();
  const { back } = useNav();
  const [paybill, setPaybill] = useState(settings?.paybill ?? '');
  const [hint, setHint] = useState(settings?.accountHint ?? '');
  const [cats, setCats] = useState((settings?.categories ?? []).join(', '));
  const [lang, setLang] = useState<ChurchSettings['language']>(settings?.language ?? 'en');
  const [approval, setApproval] = useState(settings?.requireJoinApproval ?? true);
  const [motto, setMotto] = useState(settings?.motto ?? '');
  const save = async () => {
    try {
      await api.post('/admin/settings', { settings: { paybill: paybill.replace(/\D/g, ''), accountHint: hint, categories: cats.split(',').map((x) => x.trim()).filter(Boolean), language: lang, requireJoinApproval: approval, motto } });
      await refresh(); Alert.alert('Saved', 'Your church settings were saved.');
    } catch (e) { Alert.alert('Not saved', errText(e)); }
  };
  return (
    <Screen title="Church settings" onBack={back}>
      <Card><H>Giving</H><P mute>Members see these details on the Give page.</P>
        <Field label="M-Pesa Pay Bill number" value={paybill} onChangeText={setPaybill} keyboardType="number-pad" />
        <Field label="Account name to use" value={hint} onChangeText={setHint} placeholder="Your name" />
        <Field label="Giving categories (separate with commas)" value={cats} onChangeText={setCats} multiline />
      </Card>
      <Card><H>Members</H>
        <Toggle label="New members need my approval before they can use the church pages" value={approval} onChange={setApproval} />
        <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 4 }}>{tr('Church language')}</Text>
        <Chips options={['en', 'sw'] as const} value={lang} onChange={setLang} labels={{ en: 'English', sw: 'Kiswahili' }} />
        <Field label="Church motto (optional)" value={motto} onChangeText={setMotto} />
      </Card>
      <Btn label="Save settings" onPress={save} />
    </Screen>
  );
}

// ---------------------------------------------------------------- someone who entered the church number and waits to be let in
export function WaitingToJoin() {
  const { me, church, refresh, signOut, joinStatus } = useDB();
  return (
    <Screen title="Almost there">
      <Card>
        <H>Waiting for approval</H>
        <P>{tt('Thank you, {0}. You asked to join {1}. The church admin has to let you in first. You will get in as soon as that is done.', (me?.name ?? '').split(' ')[0], church?.name ?? '')}</P>
      </Card>
      <Btn label={joinStatus === 'pending' ? 'Check again' : 'Continue'} onPress={refresh} />
      <Btn kind="ghost" label="Sign out" onPress={signOut} />
    </Screen>
  );
}

// ---------------------------------------------------------------- move to another church
export function MoveChurch() {
  const { me, church, requestOtp, lookup, moveChurch } = useDB();
  const { back, reset } = useNav();
  const [num, setNum] = useState('');
  const [found, setFound] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  if (!me) return null;
  if (me.role === 'church_admin') return <Screen title="Change church" onBack={back}><Card><P>A Church Admin cannot move away until the app developer appoints a new admin for your church. Please use the support chat to ask.</P></Card><Btn label="Talk to the app developer" onPress={openSupport} /></Screen>;
  const find = async () => {
    const r = await lookup(me.phone, num.trim());
    if (!r) return;
    if (!r.church) { setFound(''); return Alert.alert('Church not found', 'That church number was not found. Check it with your church secretary.'); }
    setFound(r.church.name);
  };
  const doMove = () => Alert.alert('Move to another church?', tt('You will leave {0} and join {1}. Your old church keeps its records, but you will see and do things in the new church only. Any leader position must be verified again.', church?.name ?? '', found), [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Move', onPress: async () => { if (await moveChurch(num.trim(), code.trim(), groups)) reset(); } },
  ]);
  return (
    <Screen title="Change church" onBack={back}>
      <Card><H>{tt('You belong to {0}', church?.name ?? '')}</H><P mute>To move, enter the special church number of your new church, then confirm it is you with a new SMS code. From then on, everything you do is linked only to the new church.</P></Card>
      <Field label="New church number" value={num} onChangeText={(v) => { setNum(v); setFound(''); }} keyboardType="number-pad" placeholder="482-7391" maxLength={8} />
      <Btn kind="ghost" label="Find the church" onPress={find} />
      {!!found && (
        <>
          <Card style={{ backgroundColor: C.primarySoft }}><P mute>New church</P><H>{found}</H></Card>
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 4 }}>{tr('Groups you belong to')}</Text>
          <Chips options={GROUPS.map((g) => g.key)} value={groups} onChange={toggle(groups, setGroups)} labels={groupLabels} />
          {!sent
            ? <Btn label="Send me a code" onPress={async () => { const r = await requestOtp(me.phone); if (r.ok) { setSent(true); setDevCode(r.devCode); } }} />
            : <>
              {devCode ? <Card><P>Test mode code: {devCode}</P></Card> : null}
              <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
              <Btn label="Move to this church" onPress={doMove} disabled={code.trim().length !== 6} />
            </>}
        </>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------- the direct line: a floating chat button for the Church Admin
export function SupportWidget() {
  const { me, supportUnread, refresh } = useDB();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<SupportMessage[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const last = useRef('');
  const scroller = useRef<ScrollView | null>(null);
  const isAdmin = !!me && me.role === 'church_admin';

  useEffect(() => { const f = () => setOpen(true); openers.add(f); return () => { openers.delete(f); }; }, []);

  const poll = useCallback(async (markRead: boolean) => {
    try {
      const r = await api.get<{ messages: SupportMessage[] }>(`/admin/support?after=${encodeURIComponent(last.current)}${markRead ? '' : '&read=0'}`);
      if (r.messages.length) { last.current = r.messages[r.messages.length - 1].at; setMsgs((m) => [...m, ...r.messages]); setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50); }
      setErr('');
    } catch (e) { setErr(errText(e)); }
  }, []);

  useEffect(() => {
    if (!open || !isAdmin) return;
    poll(true).then(refresh);
    const id = setInterval(() => poll(true), 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAdmin]);

  if (!isAdmin) return null;
  const send = async () => {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true);
    try { await api.post('/admin/support', { body }); setText(''); await poll(true); } catch (e) { Alert.alert('Not sent', errText(e)); }
    setBusy(false);
  };

  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} accessibilityLabel={tr('Talk to the app developer')}
        style={{ position: 'absolute', right: 16, bottom: 24, width: 58, height: 58, borderRadius: 29, backgroundColor: C.gold, alignItems: 'center', justifyContent: 'center', elevation: 6 }}>
        <Text style={{ fontSize: 26 }}>💬</Text>
        {supportUnread > 0 && <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: C.bad, borderRadius: 11, minWidth: 22, paddingHorizontal: 5, alignItems: 'center' }}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{supportUnread}</Text></View>}
      </Pressable>
    );
  }
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 90 }}>
      <View style={{ flex: 1, backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: C.line, elevation: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: C.line }}>
          <View><Text style={{ fontWeight: '700', fontSize: 16, color: C.ink }}>{tr('App developer')}</Text><Text style={{ color: C.mute, fontSize: 12 }}>{tr('Direct line. The developer team replies here.')}</Text></View>
          <Pressable onPress={() => setOpen(false)} hitSlop={12}><Text style={{ fontSize: 22, color: C.mute }}>✕</Text></Pressable>
        </View>
        <ScrollView ref={scroller} style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 12, gap: 8 }}>
          {msgs.length === 0 && <Text style={{ color: C.mute, textAlign: 'center', marginTop: 24 }}>{tr('No messages yet. Write to the app developer below.')}</Text>}
          {msgs.map((m) => (
            <View key={m.id} style={{ alignSelf: m.from === 'admin' ? 'flex-end' : 'flex-start', maxWidth: '82%', backgroundColor: m.from === 'admin' ? C.primarySoft : '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 9 }}>
              <Text style={{ color: C.mute, fontSize: 11 }}>{m.from === 'admin' ? tr('You') : m.name + ' · ' + tr('developer')} · {new Date(m.at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</Text>
              <Text style={{ color: C.ink, fontSize: 14 }}>{m.body}</Text>
            </View>
          ))}
        </ScrollView>
        {!!err && <Text style={{ color: C.bad, paddingHorizontal: 12, fontSize: 12 }}>{err}</Text>}
        <View style={{ flexDirection: 'row', gap: 8, padding: 10, alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: C.line }}>
          <TextInput value={text} onChangeText={setText} multiline maxLength={2000} placeholder={tr('Write a message…')} placeholderTextColor="#9CA3AF"
            style={{ flex: 1, maxHeight: 110, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, color: C.ink }} />
          <Pressable onPress={send} disabled={busy || !text.trim()} style={{ backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11, opacity: busy || !text.trim() ? 0.5 : 1 }}><Text style={{ color: '#fff', fontWeight: '700' }}>{tr('Send')}</Text></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}


// ---------------------------------------------------------------- export, import and the printable directory
interface ImportRow { line: number; name: string; phone: string; role: string | null; status: 'ready' | 'added' | 'skipped'; problem: string; note?: string }
interface ImportResult { committed: boolean; ready: number; added: number; skipped: number; results: ImportRow[] }
const TEMPLATE = 'Name,Phone,Role,ID number,Groups\nMary Wanjiku,0711222333,Church Treasurer,12345678,Dorcas; Church Choir\nPeter Otieno,0722333444,Member,,Adventist Men';

export function AdminBulk() {
  const { me, refresh } = useDB();
  const { back } = useNav();
  const [csv, setCsv] = useState('');
  const [res, setRes] = useState<ImportResult | null>(null);
  const [phones, setPhones] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!me || me.role !== 'church_admin') return <Screen title="Export, import & directory" onBack={back}><Empty text="Only the Church Admin can open this page." /></Screen>;
  const lang = getLang();
  const guard = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { Alert.alert('Not done', errText(e)); } setBusy(false); };

  return (
    <Screen title="Export, import & directory" onBack={back}>
      <Card>
        <H>Member list (spreadsheet)</H>
        <P mute>Everyone in your church as a spreadsheet file (CSV) that opens in Excel or Google Sheets.</P>
        <Btn label="Share member list" onPress={() => guard(async () => {
          const r = await api.get<{ csv: string }>(`/admin/members/export?lang=${lang}`);
          await Share.share({ message: r.csv, title: 'church-members.csv' });
        })} />
      </Card>

      <Card>
        <H>Printable directory</H>
        <P mute>A neat A–Z list of members, with the leaders first. Share it to print or to send to the church group.</P>
        <Toggle label="Include phone numbers" value={phones} onChange={setPhones} />
        <Btn label="Share directory" onPress={() => guard(async () => {
          const r = await api.get<{ text: string }>(`/admin/directory?lang=${lang}&phones=${phones ? 1 : 0}`);
          await Share.share({ message: r.text, title: 'church-directory.txt' });
        })} />
      </Card>

      <Card>
        <H>Add many members at once</H>
        <P mute>Paste a list from a spreadsheet. The first row must say Name and Phone; Role, ID number and Groups are optional. We check it first and add nobody until you confirm.</P>
        <Btn small kind="ghost" label="Show me an example" onPress={() => { setCsv(TEMPLATE); setRes(null); }} />
        <Field label="Your list" value={csv} onChangeText={(v) => { setCsv(v); setRes(null); }} multiline autoCapitalize="none" autoCorrect={false} placeholder="Name,Phone,Role" />
        <Btn label={busy ? 'Checking…' : 'Check the list'} onPress={() => guard(async () => { setRes(await api.post<ImportResult>('/admin/members/import', { csv })); })} />
        {res && (
          <View style={{ marginTop: 10 }}>
            <Row style={{ flexWrap: 'wrap' }}>
              <Badge color={C.ok} text={res.committed ? tt('{0} added', res.added) : tt('{0} ready to add', res.ready)} />
              <Badge color={res.skipped ? C.warn : C.mute} text={tt('{0} skipped', res.skipped)} />
            </Row>
            {res.results.filter((r) => r.status === 'skipped' || r.note).slice(0, 30).map((r) => (
              <P key={r.line} mute>{tt('Row {0}: {1}', r.line, r.name || '—')} – {tr(r.problem.replace(/ \(.*\)$/, '')) || r.note}</P>
            ))}
            {!res.committed && res.ready > 0 && <Btn kind="ok" label={tt('Add {0} members', res.ready)} onPress={() => guard(async () => {
              const r = await api.post<ImportResult>('/admin/members/import', { csv, commit: true }); setRes(r); await refresh();
            })} />}
          </View>
        )}
      </Card>
      <Text style={{ color: C.mute, fontSize: 12, textAlign: 'center', marginTop: 8 }}>{tr('Nothing is ever deleted: removing a member or an activity archives it, and it can be restored.')}</Text>
    </Screen>
  );
}
