import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Alert, t as tt, tr } from '../i18n';
import { Badge, Btn, Card, Empty, Field, H, P, Row, Screen } from '../components/ui';
import { C } from '../components/ui';
import { groupLabel, roleLabel } from '../data/constants';
import { useNav } from '../nav';
import { ledGroup } from '../services/permissions';
import {
  canApproveGroupPost, canArchiveActivity, canArchiveNotice, canPlanActivity, canPostCampBoard, canPostChurchBoard, canPostGroupBoard, groupPostNeedsApproval,
} from '../services/permissions';
import { useDB } from '../store/db';
import { Notice, NoticeBoardType, User } from '../types';

function NoticeCard({ n, me }: { n: Notice; me: User }) {
  const { approveNotice, archive, unarchive } = useDB();
  const canArchive = canArchiveNotice(me, n);
  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: C.gold }}>
      <Row>
        {n.status === 'pending' && <Badge text="Pending approval" color={C.warn} />}
        {n.archived && <Badge text="Archived" color={C.mute} />}
      </Row>
      <H>{n.title}</H>
      <P>{n.body}</P>
      <P mute>{n.authorName} · {roleLabel(n.authorRole)} · {new Date(n.createdAt).toLocaleString()}</P>
      {n.status === 'pending' && n.groupKey && canApproveGroupPost(me, n.groupKey) && (
        <Btn kind="ok" small label="Approve & publish" onPress={() => approveNotice(n.id)} />
      )}
      {canArchive && !n.archived && <Btn kind="ghost" small label="Archive" onPress={() => archive('notices', n.id)} />}
      {canArchive && n.archived && <Btn kind="ghost" small label="Restore" onPress={() => unarchive('notices', n.id)} />}
    </Card>
  );
}

function BoardView({ title, board, groupKey, canPost, needsApproval }: { title: string; board: NoticeBoardType; groupKey?: string; canPost: boolean; needsApproval: boolean }) {
  const { me, db, add } = useDB();
  const { back } = useNav();
  const [t, setT] = useState('');
  const [b, setB] = useState('');
  const [showArch, setShowArch] = useState(false);
  if (!me) return null;

  const all = db.notices.filter((n) => n.board === board && n.groupKey === groupKey);
  const approver = groupKey ? canApproveGroupPost(me, groupKey) : false;
  const mine = (n: Notice) => n.createdBy === me.id;
  // Pending posts are only visible to the group leader (to approve) and to their own author.
  const visible = all
    .filter((n) => (n.status === 'published' || approver || mine(n)))
    .filter((n) => showArch || !n.archived)
    .slice().reverse();

  const post = async () => {
    if (!t.trim() || !b.trim()) return Alert.alert('Missing', 'Add a title and a message.');
    // The server decides whether the post is published or waits for the group leader's approval.
    const ok = await add('notices', { board, groupKey, title: t.trim(), body: b.trim() });
    if (!ok) return;
    setT(''); setB('');
    if (needsApproval) Alert.alert('Sent', 'Your post was sent to the group leader for approval.');
  };

  return (
    <Screen title={title} onBack={back}>
      {canPost ? (
        <Card>
          <H>New notice</H>
          <Field label="Title" value={t} onChangeText={setT} />
          <Field label="Message" value={b} onChangeText={setB} multiline />
          <Btn label={needsApproval ? 'Submit for approval' : 'Post'} onPress={post} />
        </Card>
      ) : <P mute>You can read this board. Posting is limited to authorised people.</P>}
      <Btn kind="ghost" small label={showArch ? 'Hide archived' : 'Show archived'} onPress={() => setShowArch(!showArch)} />
      {visible.length ? visible.map((n) => <NoticeCard key={n.id} n={n} me={me} />) : <Empty text="No notices yet." />}
    </Screen>
  );
}

export function ChurchBoard() {
  const { me } = useDB();
  if (!me) return null;
  return <BoardView title="Church Notice Board" board="church" canPost={canPostChurchBoard(me)} needsApproval={false} />;
}
export function CampBoard() {
  const { me } = useDB();
  if (!me) return null;
  return <BoardView title="Camp Meeting Board" board="camp" canPost={canPostCampBoard(me)} needsApproval={false} />;
}
export function GroupBoard() {
  const { me } = useDB();
  const { route } = useNav();
  const g = route.params?.g ?? '';
  if (!me) return null;
  return <BoardView title={tt('{0} Board', groupLabel(g))} board="group" groupKey={g} canPost={canPostGroupBoard(me, g)} needsApproval={groupPostNeedsApproval(me, g)} />;
}

export function GroupMembers() {
  const { db } = useDB();
  const { route, back, go } = useNav();
  const g = route.params?.g ?? '';
  const members = db.users.filter((u) => u.groups.includes(g));
  return (
    <Screen title={tt('{0} members', groupLabel(g))} onBack={back}>
      <Btn kind="ghost" label="Open group board" onPress={() => go('group', { g })} />
      {members.length ? members.map((m) => <Card key={m.id}><P bold>{m.name}</P><P mute>{m.phone}</P></Card>) : <Empty text="No members yet." />}
    </Screen>
  );
}

export function Activities() {
  const { me, db, add, archive } = useDB();
  const { route, back } = useNav();
  const g = route.params?.g ?? '';
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  if (!me) return null;
  const label = g === 'church' ? tr('Church') : groupLabel(g) === g ? roleLabel(g) : groupLabel(g);
  const list = db.activities.filter((a) => a.groupKey === g && !a.archived).sort((a, b) => (a.date < b.date ? -1 : 1));
  // Only the group's own leader (or the department/office itself), the Pastor and the Secretary plan activities; everyone else reads the calendar.
  const canPlan = canPlanActivity(me, g);
  return (
    <Screen title={tt('{0} activities', label)} onBack={back}>
      {canPlan && <Card>
        <H>Plan an activity</H>
        <Field label="Activity" value={title} onChangeText={setTitle} />
        <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-11-07" />
        <Field label="Notes" value={note} onChangeText={setNote} multiline />
        <Btn label="Add to calendar" onPress={async () => {
          if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Alert.alert('Check details', 'Add a title and a date like 2026-11-07.');
          if (await add('activities', { groupKey: g, title: title.trim(), date, note })) { setTitle(''); setDate(''); setNote(''); }
        }} />
      </Card>}
      {list.length ? list.map((a) => (
        <Card key={a.id}><H>{a.title}</H><P mute>{a.date}</P><P>{a.note}</P>{canArchiveActivity(me, g) && <Btn kind="ghost" small label="Archive" onPress={() => archive('activities', a.id)} />}</Card>
      )) : <Empty text="No activities planned." />}
    </Screen>
  );
}
