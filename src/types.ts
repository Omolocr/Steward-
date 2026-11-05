// Every record in the app is "archive-only": it can be added and (where allowed) updated,
// but there is no delete operation anywhere in this codebase.
export interface Archivable {
  id: string;
  createdAt: string;
  createdBy: string; // user id
  archived: boolean;
  archivedAt?: string;
  archivedBy?: string;
  archiveReason?: string;
}

export type RoleKey = string;

/** The signed-in person / people list entry, as returned by the server. */
export interface User {
  id: string;
  name: string;
  phone: string;
  role: RoleKey; // effective role: a leader whose role is not yet verified acts as 'member'
  requestedRole: RoleKey;
  guideSeen?: string; // the role whose first-run guide this person has already seen
  roleStatus: 'approved' | 'pending' | 'declined';
  formerRoles: RoleKey[];
  groups: string[];
  church: string;
  district: string;
  station: string;
  conference: string;
  county: string;
  membershipNumber?: string | null;
}

export type NoticeBoardType = 'church' | 'group' | 'camp';
export type NoticeStatus = 'published' | 'pending';

export interface Notice extends Archivable {
  board: NoticeBoardType;
  groupKey?: string;
  title: string;
  body: string;
  authorName: string;
  authorRole: string;
  status: NoticeStatus;
  approvedBy?: string;
  approvedAt?: string;
}

export type PaymentStatus = 'pending' | 'received';

export interface Allocation {
  category: string;
  percent: number;
  amount: number;
}

export interface Payment extends Archivable {
  memberId: string;
  memberName: string;
  mpesaCode: string;
  mpesaName: string;
  purpose: string;
  amount: number;
  allocations: Allocation[];
  status: PaymentStatus;
  receivedBy?: string;
  receivedAt?: string;
  receiptNo?: string;
  /** Set by the server when M-Pesa checking is on: did the payment really arrive on the Pay Bill? */
  verification?: {
    state: 'verified' | 'amount_mismatch' | 'waiting';
    mpesaAmount?: number;
    mpesaName?: string;
    mpesaTime?: string | null;
  };
}

/** Money that reached the Pay Bill but that no member has reported yet (Treasurer and Pastor only). */
export interface UnclaimedPayment {
  code: string;
  amount: number;
  reference: string;
  name: string;
  paidAt: string | null;
  receivedAt: string;
}

export interface Receipt extends Archivable {
  receiptNo: string;
  paymentId: string;
  memberId: string;
  memberName: string;
  mpesaCode: string;
  amount: number;
  allocations: Allocation[];
  issuedBy: string;
  issuedAt: string;
  text: string;
}

export type MemberEntry = 'baptism' | 'transfer';
export type MembershipStatus = 'active' | 'application' | 'approved' | 'declined' | 'inactive' | 'transferred_out' | 'deceased';

export interface MembershipRecord extends Archivable {
  fullName: string;
  idNumber: string;
  phone: string;
  entry: MemberEntry;
  status: MembershipStatus;
  baptismDate?: string;
  fromChurch?: string;
  transferLetterRef?: string;
  boardDecision?: string;
  /** Roll changes by the Secretary or Clerk. The history keeps every step; nothing is deleted. */
  statusDate?: string;
  statusNote?: string;
  statusDestination?: string;
  statusHistory?: { from: string; to: string; date: string; by: string; note: string; destination: string }[];
  memberNumber?: string;
  note?: string;
  applicantId?: string; // set when the person applied for themselves
}

export type WelfareFund =
  | 'Burial and Benevolent Fund'
  | 'Funeral Contribution'
  | 'Hospital Fee / Sickness Contribution'
  | 'Special Situation'
  | 'Pastor Appreciation';

export interface WelfareEntry extends Archivable {
  fund: WelfareFund;
  kind: 'case' | 'contribution';
  title: string;
  amount: number;
  contributor?: string;
  note?: string;
}

export interface ProjectEntry extends Archivable {
  project: 'Church Building';
  kind: 'contribution' | 'expense' | 'update';
  title: string;
  amount: number;
  note?: string;
}

export interface Minute extends Archivable {
  kind: string; // Church Board, Church Business Meeting, etc.
  title: string;
  meetingDate: string;
  body: string;
}

export interface CareMessage extends Archivable {
  cadence: 'daily' | 'weekly';
  title: string;
  body: string;
  authorName: string;
}

export interface SermonSummary extends Archivable {
  title: string;
  preacher: string;
  audience: 'quick' | 'general' | 'kids';
  summary: string;
  readingMinutes: number; // minutes to listen to or read
  jobId?: string;
}

export interface GroupActivity extends Archivable {
  groupKey: string;
  title: string;
  date: string;
  note: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  by: string | null;
  action: string;
  col: string | null;
  rid: string | null;
  detail: string | null;
}

export interface DB {
  users: User[];
  pendingRoles: User[];
  notices: Notice[];
  payments: Payment[];
  receipts: Receipt[];
  memberships: MembershipRecord[];
  welfare: WelfareEntry[];
  projects: ProjectEntry[];
  minutes: Minute[];
  care: CareMessage[];
  sermons: SermonSummary[];
  activities: GroupActivity[];
  office: OfficeRecord[];
  campreg: CampRegistration[];
  audit: AuditEntry[];
  unclaimed: UnclaimedPayment[];
  mpesaEnabled: boolean;
}

export interface OfficeRecord extends Archivable {
  office: string; // the leader position that owns the record, e.g. 'education'
  kind: 'report' | 'plan' | 'minutes' | 'other' | 'attendance' | 'pledge' | 'pledge_payment';
  title: string;
  date: string;
  body: string;
  // Sabbath School attendance register
  classes?: { name: string; enrolled: number; present: number }[];
  visitors?: number;
  lesson?: string;
  // Building pledges: a pledge, and the payments made toward it
  pledger?: string; phone?: string; amount?: number; due?: string;
  pledgeId?: string; method?: string;
}

/** A person's registration for a camp meeting. The fee, payments and check-in are kept by the camp officers. */
export interface CampRegistration extends Archivable {
  camp: string; name: string; phone: string; memberId: string | null; church: string;
  category: 'adult' | 'youth' | 'child'; accommodation: 'tent' | 'dormitory' | 'own' | 'day'; days: number; note: string;
  fee: number; paid: number; payments: { amount: number; at: string; by: string }[]; checkedIn: boolean; checkedInAt?: string | null;
}

export type CollectionName = Exclude<keyof DB, 'audit' | 'users' | 'pendingRoles' | 'unclaimed' | 'mpesaEnabled'>;

// ---- Churches (multi-church platform). Every person belongs to exactly one church at a time, chosen with the church number
// the app developer gave that church. Everything they see and do is linked only to that church.
export interface Church {
  id: string;
  name: string;
  /** Only the Church Admin sees the church number, e.g. "482-7391". */
  number?: string;
  district: string; station: string; conference: string; county: string;
  status: 'active' | 'suspended' | 'archived';
}
export interface ChurchSettings {
  paybill: string;
  accountHint: string;
  categories: string[];
  language: 'en' | 'sw';
  motto: string;
  requireJoinApproval: boolean;
}
/** A person as listed in the Church Admin console. */
export interface Member extends User {
  joinStatus: 'approved' | 'pending';
  archived: boolean;
  createdAt: string;
}
export interface AdminOverview {
  church: Church;
  settings: ChurchSettings;
  counts: { members: number; waitingToJoin: number; rolesToVerify: number; archivedMembers: number; activities: number };
  supportUnread: number;
}
/** One message in the direct line between a Church Admin and the app developers. */
export interface SupportMessage { id: string; from: 'admin' | 'developer'; name: string; body: string; at: string }
