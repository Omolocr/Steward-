import React, { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { C, Card, H, P, Screen } from '../components/ui';
import { t as tt, tr } from '../i18n';
import { FORMER_LEADER_ROLE, LEADER_ROLES, groupLabel, roleLabel } from '../data/constants';
import { useNav } from '../nav';
import { guideRoleOf } from './Guide';
import { canReadAttendance, canReadPledges, canSeeAllCampRegistrations, canSeeYearlyReport, ledGroup } from '../services/permissions';
import { useDB } from '../store/db';
import { User } from '../types';

interface Tile { icon: string; title: string; to: string; params?: Record<string, string>; badge?: number }

// What each office does, shown at the top of its dashboard.
const dutyOf = (r: string): string => {
  if (/^elder/.test(r)) return 'Assists the Pastor in spiritual care, preaching and oversight of the church.';
  if (ledGroup({ role: r } as User)) return "Leads this group: posts to its board, approves members' posts and plans activities.";
  const m: Record<string, string> = {church_admin: "Runs this church's page: adds and archives members, sets up giving, and has a direct line to the app developer.", pastor: "Leads the Church Board, decides transfers, posts Pastoral Care and records sermons.", treasurer: "Receives tithes and offerings, sends receipts and prepares the monthly report.", secretary: "Keeps membership, the Minute Vault and the church notice board; verifies leader positions.", clerk: "Keeps membership records with the Secretary and handles church correspondence.", sabbath_school: "Plans and coordinates Sabbath School and keeps the weekly attendance register.", education: "Coordinates church education work.", camp_secretary: "Keeps camp meeting records, registrations and fees, and runs the Camp Meeting Board.", camp_chair: "Leads camp meeting planning and its committee.", camp_clerk: "Keeps camp meeting registers and correspondence.", building: "Leads the Church Building project, keeps the pledge list and records contributions and spending.", special: "Plans special groups and occasions."};
  return m[r] ?? '';
};

// One dashboard per role. A tile only appears for the roles that own that feature.
export function tilesFor(u: User, counts: { pendingPay: number; pendingTransfer: number; pendingPosts: number; pendingRoles: number }): Tile[] {
  const r = u.role;
  const active = LEADER_ROLES.some((x) => x.key === r);
  const former = r === FORMER_LEADER_ROLE;
  const elder = /^elder/.test(r);
  const lg = ledGroup(u);
  const t: Tile[] = [
    { icon: '💝', title: 'Give (Tithe & Offering)', to: 'give' },
    { icon: '📄', title: 'Giving Statement', to: 'statement' },
    { icon: '🧾', title: 'My Receipts', to: 'receipts' },
    { icon: '📢', title: 'Church Notice Board', to: 'church' },
    { icon: '⛺', title: 'Camp Meeting Board', to: 'camp' },
    { icon: '🏗️', title: 'Building Project', to: 'project' },
    { icon: '🕊️', title: 'Pastoral Care', to: 'care' },
  ];
  // Every group the person belongs to has its own board and calendar.
  u.groups.forEach((g) => { t.push({ icon: '👥', title: tt('{0} Board', groupLabel(g)), to: 'group', params: { g } }, { icon: '🗓️', title: tt('{0} Activities', groupLabel(g)), to: 'activities', params: { g } }); });
  // People without a membership number (for example someone who has just moved here) can apply to join by transfer.
  if (!u.membershipNumber && (r === 'member' || former)) t.push({ icon: '🔁', title: 'Join by Transfer', to: 'transfer' });
  // Every leader (and former leader, as an adviser) can see the Welfare funds; only the people who run them can add to them.
  if (active || former) t.push({ icon: '🤝', title: 'Welfare', to: 'welfare' });
  // Every leader has their own activity calendar. Group leaders use their group's calendar (added below).
  if (active && !lg) t.push({ icon: '🗓️', title: tt('{0} Activities', roleLabel(r)), to: 'activities', params: { g: r } });
  // Reports, plans and minutes each leader keeps for their own office (Pastor and Secretary can read all offices).
  if (active) t.push({ icon: '📁', title: 'Office Records', to: 'office' });

  if (canReadAttendance(u)) t.push({ icon: '📝', title: r === 'sabbath_school' ? 'Attendance Register' : 'Sabbath School Attendance', to: 'attendance' });
  if (canReadPledges(u)) t.push({ icon: '🤲', title: 'Building Pledges', to: 'pledges' });
  t.push({ icon: '🎟️', title: canSeeAllCampRegistrations(u) ? 'Camp Registrations' : 'Camp Meeting Registration', to: 'campreg' });
  if (canSeeYearlyReport(u)) t.push({ icon: '📈', title: 'Annual Church Report', to: 'yearly' });
  if (r === 'church_admin') t.push({ icon: '🛠️', title: 'Church Admin Console', to: 'admin' }, { icon: '👥', title: 'Members', to: 'adminMembers' }, { icon: '⚙️', title: 'Church settings', to: 'adminSettings' }, { icon: '✅', title: 'Verify Leader Positions', to: 'roles', badge: counts.pendingRoles }, { icon: '🗓️', title: 'Church Activities', to: 'activities', params: { g: 'church' } }, { icon: '🗃️', title: 'Archive & Audit', to: 'archive' });
  if (r === 'treasurer') t.push({ icon: '💰', title: 'Payments Inbox', to: 'payments', badge: counts.pendingPay }, { icon: '🧮', title: 'Reconciliation & Cash-up', to: 'reconcile' }, { icon: '📊', title: 'Monthly Report', to: 'report' });
  if (r === 'secretary' || r === 'pastor') t.push({ icon: '✅', title: 'Verify Leader Positions', to: 'roles', badge: counts.pendingRoles });
  if (r === 'secretary') t.push({ icon: '📋', title: 'Membership', to: 'membership' }, { icon: '🗄️', title: 'Minute Vault', to: 'minutes' }, { icon: '📝', title: 'Minutes Builder', to: 'minutesBuilder' }, { icon: '📇', title: 'Membership Roll', to: 'roll' }, { icon: '🎙️', title: 'Sermon Recorder', to: 'sermon' }, { icon: '🗃️', title: 'Archive & Audit', to: 'archive' });
  if (r === 'clerk') t.push({ icon: '📋', title: 'Membership', to: 'membership' }, { icon: '📇', title: 'Membership Roll', to: 'roll' }, { icon: '🗄️', title: 'Minutes (read)', to: 'minutes' });
  if (r === 'pastor') t.push({ icon: '📋', title: 'Membership & Transfers', to: 'membership', badge: counts.pendingTransfer }, { icon: '📇', title: 'Membership Roll', to: 'roll' }, { icon: '🧮', title: 'Reconciliation & Cash-up', to: 'reconcile' }, { icon: '💰', title: 'Payments Overview', to: 'payments' }, { icon: '📊', title: 'Monthly Report', to: 'report' }, { icon: '🎙️', title: 'Sermon Recorder', to: 'sermon' }, { icon: '🗄️', title: 'Minutes (read)', to: 'minutes' }, { icon: '🗃️', title: 'Archive & Audit', to: 'archive' });
  if (elder) t.push({ icon: '🎙️', title: 'Sermon Recorder', to: 'sermon' }, { icon: '📋', title: 'Membership (view)', to: 'membership' }, { icon: '🗄️', title: 'Minutes (read)', to: 'minutes' });
  if (lg) {
    t.push({ icon: '👥', title: tt('{0} Board', groupLabel(lg)), to: 'group', params: { g: lg }, badge: counts.pendingPosts });
    t.push({ icon: '🗓️', title: 'Group Activities', to: 'activities', params: { g: lg } });
    t.push({ icon: '🙋', title: 'Group Members', to: 'members', params: { g: lg } });
  }
  // Anyone who is not the Church Admin can move to another church with that church's number.
  if (r !== 'church_admin') t.push({ icon: '⛪', title: 'Change church', to: 'move' });
  if (former) t.push({ icon: '🎖️', title: 'Advisory: Archive library', to: 'archive' });
  // de-duplicate by destination + params
  const seen = new Set<string>();
  return t.filter((x) => { const k = x.to + JSON.stringify(x.params ?? {}); if (seen.has(k)) return false; seen.add(k); return true; });
}

const autoShown = new Set<string>(); // stops the guide from reopening in a loop if saving "seen" fails

export default function Home() {
  const { me, db, signOut, online, church, outbox } = useDB();
  const { go } = useNav();
  // The first time someone opens the app with a role (and again if their role changes), the guide for that role opens once.
  const needGuide = !!me && me.guideSeen !== guideRoleOf(me) && !autoShown.has(me.id + guideRoleOf(me));
  useEffect(() => { if (me && needGuide) { autoShown.add(me.id + guideRoleOf(me)); go('guide'); } }, [needGuide]);
  if (!me) return null;
  const lg = ledGroup(me);
  const counts = {
    pendingPay: db.payments.filter((p) => p.status === 'pending' && !p.archived).length,
    pendingTransfer: db.memberships.filter((m) => m.status === 'application' && !m.archived).length,
    pendingRoles: db.pendingRoles.length,
    pendingPosts: lg ? db.notices.filter((n) => n.groupKey === lg && n.status === 'pending' && !n.archived).length : 0,
  };
  const tiles = [...tilesFor(me, counts), { icon: '🧭', title: 'How this works', to: 'guide' }];
  return (
    <Screen title="Church Connect">
      <View style={{ backgroundColor: C.primary, borderRadius: 14, padding: 16, marginBottom: 12 }}>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>{tt('Welcome, {0}', me.name.split(' ')[0])}</Text>
        <Text style={{ color: '#DBE8F5', marginTop: 2 }}>{roleLabel(me.role)}</Text>
        <Text style={{ color: '#DBE8F5', fontSize: 12 }}>{church?.name ?? me.church}{me.station ? ' · ' + me.station : ''}</Text>
        {!!dutyOf(me.role) && <Text style={{ color: '#fff', fontSize: 12, marginTop: 6 }}>{tr(dutyOf(me.role))}</Text>}
      </View>
      {!online && <Card style={{ backgroundColor: '#FDEBD3' }}><P>You are offline. Showing the last information received. Minutes, notices, activities, office records and care messages are saved on this phone and sent when you are back online; payments need internet.</P></Card>}
      {(outbox.queued.length + outbox.rejected.length) > 0 && (
        <Pressable onPress={() => go('outbox')}><Card style={{ backgroundColor: '#E8F1FB' }}>
          <H>{tt('{0} waiting to be sent', String(outbox.queued.length))}</H>
          {outbox.rejected.length > 0 && <P>{tt('{0} not accepted by the church', String(outbox.rejected.length))}</P>}
          <P mute>Tap to see them.</P>
        </Card></Pressable>
      )}
      {me.roleStatus === 'pending' && (
        <Card style={{ backgroundColor: '#FDEBD3' }}>
          <H>Position awaiting verification</H>
          <P>{tt('You asked for: {0}. Until the Church Secretary or Pastor verifies it, you see the member dashboard.', roleLabel(me.requestedRole))}</P>
        </Card>
      )}
      {me.roleStatus === 'declined' && <Card><P>{tt('Your request for {0} was not approved. Please speak to the Church Secretary.', roleLabel(me.requestedRole))}</P></Card>}
      {me.role === FORMER_LEADER_ROLE && (
        <Card>
          <H>Advisory role</H>
          <P mute>{tt('Previously served as: {0}. Former leaders advise and assist: read access to records and boards, plus giving and Pastoral Care.', me.formerRoles.map(roleLabel).join(', ') || '—')}</P>
        </Card>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {tiles.map((t) => (
          <Pressable key={t.to + JSON.stringify(t.params)} onPress={() => go(t.to, t.params)}
            style={{ width: '48%', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center' }}>
            {!!t.badge && <View style={{ position: 'absolute', top: 6, right: 8, backgroundColor: C.bad, borderRadius: 10, paddingHorizontal: 7 }}><Text style={{ color: '#fff', fontSize: 11 }}>{t.badge}</Text></View>}
            <Text style={{ fontSize: 26 }}>{t.icon}</Text>
            <Text style={{ fontSize: 13, fontWeight: '600', marginTop: 4, textAlign: 'center', color: C.ink }}>{tr(t.title)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ color: C.mute, textAlign: 'center', marginTop: 16, fontSize: 12 }}>Nothing is ever deleted — records are archived and kept.</Text>
      <View style={{ marginTop: 12 }}><Pressable onPress={signOut}><Text style={{ color: C.primary, textAlign: 'center' }}>{tr('Sign out')}</Text></Pressable></View>
    </Screen>
  );
}
