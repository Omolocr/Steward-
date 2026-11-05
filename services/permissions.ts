import { CAMP_ROLES, FORMER_LEADER_ROLE, LEADER_ROLES } from '../data/constants';
import { Notice, User } from '../types';

export const isActiveLeader = (u: User) => LEADER_ROLES.some((r) => r.key === u.role);
export const isRole = (u: User, ...roles: string[]) => roles.includes(u.role);
export const ledGroup = (u: User): string | undefined => LEADER_ROLES.find((r) => r.key === u.role)?.leadsGroup;
export const isGroupLeader = (u: User, groupKey: string) => ledGroup(u) === groupKey;

// ---- Church-wide board: every active church leader may post; only the Church Secretary archives.
export const canPostChurchBoard = (u: User) => isActiveLeader(u) || u.role === 'church_admin';
export const canArchiveChurchBoard = (u: User) => isRole(u, 'secretary', 'church_admin');

// ---- Group boards
// Group leader posts freely. Other church leaders and group members post, but need the group leader's approval.
export const canViewGroupBoard = (u: User, groupKey: string) =>
  isGroupLeader(u, groupKey) || u.groups.includes(groupKey) || isRole(u, 'pastor', 'secretary', 'clerk', 'church_admin') || isActiveLeader(u) || u.role === FORMER_LEADER_ROLE;
export const canPostGroupBoard = (u: User, groupKey: string) =>
  isGroupLeader(u, groupKey) || isActiveLeader(u) || u.groups.includes(groupKey);
export const groupPostNeedsApproval = (u: User, groupKey: string) => !isGroupLeader(u, groupKey);
export const canApproveGroupPost = (u: User, groupKey: string) => isGroupLeader(u, groupKey);
// Church Secretary and the group's own leader may archive group posts.
export const canArchiveGroupBoard = (u: User, groupKey: string) => isGroupLeader(u, groupKey) || isRole(u, 'secretary', 'church_admin');

// ---- Camp meeting board: camp leaders and the pastor post.
export const canPostCampBoard = (u: User) => CAMP_ROLES.includes(u.role) || u.role === 'pastor';
export const canArchiveCampBoard = (u: User) => u.role === 'camp_secretary' || u.role === 'pastor';

export const canArchiveNotice = (u: User, n: Notice) =>
  n.board === 'church' ? canArchiveChurchBoard(u) : n.board === 'group' ? canArchiveGroupBoard(u, n.groupKey!) : canArchiveCampBoard(u);

// ---- Membership: kept by Secretary and Clerk; transfers decided by the Church Board led by the Pastor.
/** The yearly report is for the Pastor and the Church Board (totals only). */
export const canSeeYearlyReport = (u: User) => isRole(u, 'pastor', 'treasurer', 'secretary', 'clerk', 'elder1', 'elder2', 'elder3', 'elder4');
/** One-tap confirmation of payments that M-Pesa itself has already confirmed. */
export const canConfirmVerified = (u: User) => isRole(u, 'treasurer');
export const canSeeReconciliation = (u: User) => isRole(u, 'treasurer', 'pastor');
export const canIssueLetters = (u: User) => isRole(u, 'secretary', 'clerk', 'pastor');
export const canManageMembership = (u: User) => isRole(u, 'secretary', 'clerk');
export const canDecideTransfer = (u: User) => isRole(u, 'pastor');
export const canViewMembership = (u: User) => isRole(u, 'secretary', 'clerk', 'pastor') || /^elder/.test(u.role);

// ---- Money
export const canReceivePayments = (u: User) => u.role === 'treasurer';
export const canViewAllPayments = (u: User) => isRole(u, 'treasurer', 'pastor');

// ---- Welfare / projects
export const canManageWelfare = (u: User) => isRole(u, 'treasurer', 'secretary', 'pastor', 'dorcas_leader');
export const canManageProject = (u: User) => isRole(u, 'building', 'treasurer');

// ---- Minutes vault: only the Church Secretary writes/archives; pastor and clerk can read.
export const canWriteMinutes = (u: User) => u.role === 'secretary';
export const canReadMinutes = (u: User) => isRole(u, 'secretary', 'pastor', 'clerk') || /^elder/.test(u.role);

// ---- Pastoral Care
export const canPostCare = (u: User) => isRole(u, 'pastor') || /^elder/.test(u.role);
export const canRecordSermon = (u: User) => isRole(u, 'pastor', 'secretary') || /^elder/.test(u.role);
export const canArchiveCare = (u: User) => isRole(u, 'pastor');

// ---- Activities (calendars): the group's own leader (or the office itself), Pastor, Secretary and the Church Admin plan and archive them.
export const canPlanActivity = (u: User, groupKey: string) => ledGroup(u) === groupKey || u.role === groupKey || isRole(u, 'pastor', 'secretary', 'church_admin');

export const canArchiveActivity = (u: User, groupKey: string) => ledGroup(u) === groupKey || u.role === groupKey || isRole(u, 'secretary', 'church_admin');

// ---- Church Admin: members, settings and the direct line to the app developer.
export const isChurchAdmin = (u: User) => u.role === 'church_admin';

// ---- Office tools. Each belongs to one office; the Pastor and Secretary can read every office's records.
export const canKeepAttendance = (u: User) => u.role === 'sabbath_school';
export const canReadAttendance = (u: User) => isRole(u, 'sabbath_school', 'pastor', 'secretary');
export const canKeepPledges = (u: User) => u.role === 'building';
export const canReadPledges = (u: User) => isRole(u, 'building', 'pastor', 'secretary');
// Camp meeting registration: anyone registers themselves; the camp officers run it and the Pastor can see it.
export const canManageCamp = (u: User) => CAMP_ROLES.includes(u.role);
export const canSeeAllCampRegistrations = (u: User) => CAMP_ROLES.includes(u.role) || u.role === 'pastor';
