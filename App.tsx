import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { C } from './src/components/ui';
import { NavProvider, useNav } from './src/nav';
import SignUp from './src/screens/Auth';
import { Activities, CampBoard, ChurchBoard, GroupBoard, GroupMembers } from './src/screens/Boards';
import { Care, Sermon } from './src/screens/Care';
import Home from './src/screens/Home';
import { Give, PaymentsInbox, Receipts } from './src/screens/Money';
import { ArchiveScreen, Membership, OfficeRecords, Minutes, Project, RoleApprovals, TransferApply, Welfare } from './src/screens/Records';
import { registerForPush, onNotificationTap } from './src/push';
import { AttendanceRegister, CampRegistrationScreen, Pledges } from './src/screens/Tools';
import { DBProvider, useDB } from './src/store/db';
import { Guide } from './src/screens/Guide';
import { AdminConsole, AdminMembers, AdminSettings, MoveChurch, openSupport, SupportWidget, WaitingToJoin, AdminBulk } from './src/screens/Admin';
import { LangKeyed, LangProvider } from './src/LangProvider';
import { Reconcile, MinutesBuilder, RollScreen } from './src/screens/Clerks';
import Outbox from './src/screens/Outbox';
import { MonthlyReport, Statement, YearlyReport } from './src/screens/Reports';

const ROUTES: Record<string, React.ComponentType> = {
  home: Home, give: Give, receipts: Receipts, payments: PaymentsInbox,
  church: ChurchBoard, camp: CampBoard, group: GroupBoard, members: GroupMembers, activities: Activities,
  membership: Membership, welfare: Welfare, project: Project, minutes: Minutes, archive: ArchiveScreen,
  care: Care, sermon: Sermon, roles: RoleApprovals, transfer: TransferApply, statement: Statement, report: MonthlyReport, yearly: YearlyReport, outbox: Outbox, reconcile: Reconcile, roll: RollScreen, minutesBuilder: MinutesBuilder, office: OfficeRecords, attendance: AttendanceRegister, pledges: Pledges, campreg: CampRegistrationScreen,
  guide: Guide, admin: AdminConsole, adminMembers: AdminMembers, adminBulk: AdminBulk, adminSettings: AdminSettings, move: MoveChurch,
};

// Registers this phone for push notifications once someone is signed in and let in, and opens the right screen on a tap.
export const TAP_ROUTES: Record<string, string> = {
  receipts: 'receipts', payments: 'payments', church: 'church', camp: 'camp', group: 'group', home: 'home',
  // sent by the daily reminders (server.mjs runReminders): pending transfers, leader-role approvals, join requests
  membership: 'membership', roles: 'roles', adminMembers: 'adminMembers',
};
function PushBridge() {
  const { me, joinStatus } = useDB();
  const { go, reset } = useNav();
  const who = me?.id;
  React.useEffect(() => { if (who && joinStatus !== 'pending') registerForPush(); }, [who, joinStatus]);
  React.useEffect(() => onNotificationTap((s) => {
    if (s === 'support') { openSupport(); return; }
    const r = TAP_ROUTES[s]; if (!r) return;
    reset(); if (r !== 'home') go(r);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Router() {
  const { ready, me, joinStatus } = useDB();
  const { route } = useNav();
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={C.primary} /></View>;
  if (!me) return <SignUp />;
  // Entered a church number but the Church Admin has not let them in yet.
  if (joinStatus === 'pending') return <WaitingToJoin />;
  const Comp = ROUTES[route.name] ?? Home;
  return <><Comp /><SupportWidget /></>;
}

export default function App() {
  return (
    <LangProvider>
      <DBProvider>
        <NavProvider>
          <StatusBar style="light" />
        <PushBridge />
          <LangKeyed><Router /></LangKeyed>
        </NavProvider>
      </DBProvider>
    </LangProvider>
  );
}
