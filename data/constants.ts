export interface RoleDef {
  key: string;
  label: string;
  kind: 'department' | 'group' | 'elder' | 'camp' | 'committee' | 'special';
  // group leaders lead exactly one group
  leadsGroup?: string;
}

export const GROUPS: { key: string; label: string }[] = [
  { key: 'dorcas', label: 'Dorcas' },
  { key: 'men', label: 'Adventist Men' },
  { key: 'youth', label: 'Adventist Youth' },
  { key: 'pathfinders', label: 'Pathfinders' },
  { key: 'adventurers', label: 'Adventurers' },
  { key: 'choir', label: 'Church Choir' },
];

export const LEADER_ROLES: RoleDef[] = [
  { key: 'pastor', label: 'Pastor (Pastor\'s Office)', kind: 'department' },
  { key: 'treasurer', label: 'Church Treasurer', kind: 'department' },
  { key: 'secretary', label: 'Church Secretary', kind: 'department' },
  { key: 'clerk', label: 'Church Clerk', kind: 'department' },
  { key: 'sabbath_school', label: 'Sabbath School Department', kind: 'department' },
  { key: 'education', label: 'Education Department', kind: 'department' },
  { key: 'elder1', label: 'Church Elder 1', kind: 'elder' },
  { key: 'elder2', label: 'Church Elder 2', kind: 'elder' },
  { key: 'elder3', label: 'Church Elder 3', kind: 'elder' },
  { key: 'elder4', label: 'Church Elder 4', kind: 'elder' },
  { key: 'camp_secretary', label: 'Camp Meeting Secretary', kind: 'camp' },
  { key: 'camp_chair', label: 'Camp Meeting Chairperson', kind: 'camp' },
  { key: 'camp_clerk', label: 'Camp Meeting Clerk', kind: 'camp' },
  { key: 'building', label: 'Building Committee', kind: 'committee' },
  { key: 'special', label: 'Special Groups and Occasions', kind: 'special' },
  { key: 'dorcas_leader', label: 'Dorcas Leader', kind: 'group', leadsGroup: 'dorcas' },
  { key: 'men_leader', label: 'Adventist Men Leader', kind: 'group', leadsGroup: 'men' },
  { key: 'youth_leader', label: 'Adventist Youth Leader', kind: 'group', leadsGroup: 'youth' },
  { key: 'pathfinder_leader', label: 'Pathfinder Director', kind: 'group', leadsGroup: 'pathfinders' },
  { key: 'adventurer_leader', label: 'Adventurer Director', kind: 'group', leadsGroup: 'adventurers' },
  { key: 'choir_leader', label: 'Church Choir Director', kind: 'group', leadsGroup: 'choir' },
];

export const MEMBER_ROLE = 'member';
export const FORMER_LEADER_ROLE = 'former_leader';
/** Appointed by the app developer for each church; not a position anyone can pick at sign-up. */
export const CHURCH_ADMIN_ROLE = 'church_admin';

import { tr } from '../i18n';

export const CAMP_ROLES = ['camp_secretary', 'camp_chair', 'camp_clerk'];

export const roleLabel = (key: string): string =>
  tr(key === MEMBER_ROLE
    ? 'Member'
    : key === FORMER_LEADER_ROLE
      ? 'Former Leader (Advisor)'
      : key === CHURCH_ADMIN_ROLE
        ? 'Church Admin'
        : LEADER_ROLES.find((r) => r.key === key)?.label ?? key);

export const groupLabel = (key: string): string => tr(GROUPS.find((g) => g.key === key)?.label ?? key);

// Payment categories the treasurer receives.
export const PAYMENT_CATEGORIES = [
  'Tithe',
  'Offering',
  '13th Sabbath',
  'Church Budget',
  'Field Advance',
  'Camp Meeting',
  'Church Building',
  'Welfare / Benevolent',
  'Other',
];

// Suggested default split shown to the member (editable).
export const DEFAULT_SPLIT: Record<string, number> = { Tithe: 10, Offering: 20 };

// Replace with your church's real M-Pesa Pay Bill details.
export const PAYBILL = { number: '000000', account: 'Your Church Name' };

export const WELFARE_FUNDS = [
  'Burial and Benevolent Fund',
  'Funeral Contribution',
  'Hospital Fee / Sickness Contribution',
  'Special Situation',
  'Pastor Appreciation',
] as const;

export const MINUTE_KINDS = [
  'Church Board',
  'Church Business Meeting',
  'Elders\' Meeting',
  'Building Committee',
  'Camp Meeting Committee',
  'Other',
];
