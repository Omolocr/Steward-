// Church Admin bulk tools: CSV export of members, CSV import (with a safe preview), and a printable directory.
// Pure functions only (no database), so they are easy to test. Nothing here deletes anything.
import { ROLE_NAMES, GROUP_NAMES } from './messages.mjs';

export const MAX_IMPORT_ROWS = 500;

// A cell that starts with = + - @ could run as a formula in Excel, so it is shown as plain text.
export const csvCell = (v) => {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
export const csvLine = (cells) => cells.map(csvCell).join(',');

/** Parses CSV text (quotes, CRLF, BOM; delimiter , ; or tab is detected from the first line). Returns array of string arrays. */
export function parseCsv(text) {
  let s = String(text || '').replace(/^﻿/, '');
  const first = s.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (c === ch && !q) n++; } return n; };
  const delim = [',', ';', '\t'].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
  const D = delim[1] > 0 ? delim[0] : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === D) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const HEAD = {
  name: ['name', 'full name', 'fullname', 'jina', 'jina kamili', 'member'],
  phone: ['phone', 'phone number', 'mobile', 'telephone', 'tel', 'simu', 'nambari ya simu'],
  role: ['role', 'position', 'nafasi'],
  idNumber: ['id', 'id number', 'id no', 'national id', 'kitambulisho', 'nambari ya kitambulisho'],
  membershipNumber: ['membership number', 'membership no', 'member number', 'nambari ya uanachama'],
  groups: ['groups', 'group', 'vikundi', 'kikundi'],
};
const fieldOf = (h) => Object.keys(HEAD).find((k) => HEAD[k].includes(norm(h)));

/** Role text -> role key. Accepts the key, the English name or the Kiswahili name. Blank = member. Returns null when unknown. */
export function matchRole(text, leaderRoles) {
  const t = norm(text); if (!t || t === 'member' || t === 'mshiriki') return 'member';
  if (t === 'former leader' || t === 'former leader advisor' || t === 'advisor' || t === 'kiongozi wa zamani') return 'former_leader';
  for (const k of leaderRoles) {
    if (norm(k) === t) return k;
    const n = ROLE_NAMES[k]; if (n && (norm(n[0]) === t || norm(n[1]) === t)) return k;
  }
  return null;
}
/** Groups text ("dorcas; youth") -> { keys, unknown }. */
export function matchGroups(text) {
  const keys = [], unknown = [];
  for (const part of String(text || '').split(/[;|\/]+/).map((x) => x.trim()).filter(Boolean)) {
    const t = norm(part); const k = Object.keys(GROUP_NAMES).find((g) => norm(g) === t || norm(GROUP_NAMES[g][0]) === t || norm(GROUP_NAMES[g][1]) === t);
    if (k) { if (!keys.includes(k)) keys.push(k); } else unknown.push(part);
  }
  return { keys, unknown };
}

/** Turns CSV text into candidate rows. Throws {message} for a bad file. Each row: { line, name, phone, role, idNumber, membershipNumber, groups, groupsUnknown } */
export function readImport(text, leaderRoles) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file needs a first row with column names (Name, Phone, Role...) and at least one member.');
  const cols = rows[0].map(fieldOf);
  if (!cols.includes('name') || !cols.includes('phone')) throw new Error('The first row must have a Name column and a Phone column.');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Please import at most ${MAX_IMPORT_ROWS} people at a time.`);
  return rows.slice(1).map((r, i) => {
    const o = { line: i + 2 }; cols.forEach((f, j) => { if (f) o[f] = String(r[j] ?? '').trim(); });
    const role = matchRole(o.role, leaderRoles); const g = matchGroups(o.groups);
    return { line: o.line, name: (o.name || '').slice(0, 100), phone: o.phone || '', roleText: o.role || '', role, idNumber: (o.idNumber || '').slice(0, 30), membershipNumber: (o.membershipNumber || '').slice(0, 30), groups: g.keys, groupsUnknown: g.unknown };
  });
}

export const memberCsv = (members, roleLabel, groupLabel) =>
  '﻿' + [csvLine(['Name', 'Phone', 'Role', 'ID number', 'Membership number', 'Groups', 'Status', 'Joined']),
    ...members.map((m) => csvLine([m.name, m.phone, roleLabel(m.role), m.idNumber || '', m.membershipNumber || '', (m.groups || []).map(groupLabel).join('; '), m.archived ? 'Archived' : m.joinStatus === 'pending' ? 'Waiting to join' : 'Active', (m.createdAt || '').slice(0, 10)]))].join('\r\n') + '\r\n';

/** A plain-text directory, grouped by position then A-Z. phones=false leaves the numbers out (for noticeboards). */
export function directoryText({ church, members, roleLabel, sw, phones }) {
  const L = sw ? { title: 'ORODHA YA WASHIRIKI', total: 'Jumla ya washiriki', leaders: 'Viongozi', others: 'Washiriki' } : { title: 'MEMBERS\' DIRECTORY', total: 'Total members', leaders: 'Leaders', others: 'Members' };
  const line = (m) => `  ${m.name}${phones && m.phone ? '  ' + m.phone : ''}`;
  const lead = members.filter((m) => m.role !== 'member' && m.role !== 'former_leader').sort((a, b) => roleLabel(a.role).localeCompare(roleLabel(b.role)) || a.name.localeCompare(b.name));
  const rest = members.filter((m) => !lead.includes(m)).sort((a, b) => a.name.localeCompare(b.name));
  return [L.title, church, `${L.total}: ${members.length}`, '', L.leaders, ...lead.map((m) => `${line(m)}  (${roleLabel(m.role)})`), '', L.others, ...rest.map(line)].join('\n');
}
