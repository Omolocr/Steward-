// Church Connect – the App Developer console API and the Church Admin API.
//
// Two audiences:
//  * App developers (at most 10 active at a time): create churches (each one a fresh, independent copy of the client console with the
//    church's name written on it), assign each church its special church number, appoint the church's admin, pause/archive a church,
//    manage the developer team, and answer the churches' support chat. A developer never reads a church's money, minutes or members' details.
//  * Church Admins: add members, archive ("delete") members and activities, approve people who joined with the church number,
//    set up the church (Pay Bill, categories, language) and talk to the developers through the support widget.
//
// Archive-only: "delete" in both consoles means archive. Everything archived can be restored, and everything is written to an audit trail.
import fs from 'node:fs';
import path from 'node:path';
import { fmtNumber, validNumber } from './platform.mjs';
import { csvLine, directoryText, memberCsv, readImport } from './bulk.mjs';
import { GROUP_NAMES, roleName } from './messages.mjs';

export const MAX_DEVELOPERS = 10;

export function installConsole(k) {
  const { route, must, P, pq, pq1, prun, plog, uid, now, sign, checkOtp, useOtp, limited, normPhone, churchOf, inChurch, ctx, q, q1, run, log, actor, publicUser, archiveUser, supportUnread, isIn, LEADER_ROLES, sendSms, DEV, notifyUsers, notifyAdmins, HttpError } = k;
  const here = path.dirname(new URL(import.meta.url).pathname);

  // ---------------------------------------------------------------- developers
  const activeDevs = () => pq1("SELECT COUNT(*) n FROM developers WHERE status='active'").n;
  const devPublic = (d) => ({ id: d.id, name: d.name, phone: d.phone, status: d.status, createdAt: d.created_at, archivedAt: d.archived_at });
  function addDeveloper(phone, name, by) {
    const ph = normPhone(phone); must(ph, 400, 'Enter a valid Kenyan phone number.');
    const nm = String(name || '').trim().slice(0, 80); must(nm.length >= 2, 400, 'Write the developer\'s name.');
    must(activeDevs() < MAX_DEVELOPERS, 409, `The developer team is full (${MAX_DEVELOPERS} people). Archive someone first.`);
    const ex = pq1('SELECT * FROM developers WHERE phone=?', ph);
    if (ex) { must(ex.status !== 'active', 409, 'That person is already on the team.'); prun("UPDATE developers SET status='active', archived_at=NULL, name=? WHERE id=?", nm, ex.id); plog(by, 'developer.restore', null, ph); return pq1('SELECT * FROM developers WHERE id=?', ex.id); }
    const id = uid(); prun('INSERT INTO developers(id,phone,name,status,created_by,created_at) VALUES(?,?,?,?,?,?)', id, ph, nm, 'active', by, now());
    plog(by, 'developer.add', null, ph + ' ' + nm); return pq1('SELECT * FROM developers WHERE id=?', id);
  }
  // First start: DEVELOPERS="0711111111:Amina,0722222222:Brian" creates the first developers (the platform owner).
  for (const x of (process.env.DEVELOPERS || '').split(',').filter(Boolean)) {
    const [ph, nm] = x.split(':'); const p = normPhone(ph);
    if (p && !pq1('SELECT 1 FROM developers WHERE phone=?', p) && activeDevs() < MAX_DEVELOPERS) addDeveloper(p, nm || 'Developer', 'system');
  }
  if (!pq1('SELECT 1 FROM developers')) console.warn('No app developer yet. Start the server with DEVELOPERS="07XXXXXXXX:Your Name" to create the first one.');

  route('POST', '/dev/login', false, ({ body, ip }) => {
    const phone = normPhone(body.phone); must(phone, 400, 'Invalid phone number.');
    must(!limited('devlogin:' + ip, 30, 3600e3), 429, 'Too many attempts. Please try again later.');
    const d = pq1("SELECT * FROM developers WHERE phone=? AND status='active'", phone);
    must(d, 403, 'This number is not on the app developer team.');
    checkOtp(phone, body.code, ip); useOtp(phone);
    return { token: sign({ dev: d.id, exp: Date.now() + 12 * 3600e3 }), developer: devPublic(d), limit: MAX_DEVELOPERS };
  });
  route('GET', '/dev/me', 'dev', ({ dev }) => ({ developer: devPublic(dev), limit: MAX_DEVELOPERS, active: activeDevs() }));

  route('GET', '/dev/team', 'dev', () => ({ limit: MAX_DEVELOPERS, active: activeDevs(), developers: pq('SELECT * FROM developers ORDER BY status, name').map(devPublic) }));
  route('POST', '/dev/team', 'dev', ({ dev, body }) => ({ developer: devPublic(addDeveloper(body.phone, body.name, dev.id)), active: activeDevs() }));
  route('POST', '/dev/team/:id/archive', 'dev', ({ dev, params }) => {
    const d = pq1('SELECT * FROM developers WHERE id=?', params.id); must(d, 404, 'Not found.');
    must(d.id !== dev.id, 409, 'You cannot archive yourself. Ask another developer.');
    must(d.status === 'active', 409, 'Already archived.');
    prun("UPDATE developers SET status='archived', archived_at=? WHERE id=?", now(), d.id); plog(dev.id, 'developer.archive', null, d.phone);
    return { developer: devPublic(pq1('SELECT * FROM developers WHERE id=?', d.id)), active: activeDevs() };
  });
  route('POST', '/dev/team/:id/restore', 'dev', ({ dev, params }) => {
    const d = pq1('SELECT * FROM developers WHERE id=?', params.id); must(d, 404, 'Not found.');
    must(d.status !== 'active', 409, 'Already active.');
    must(activeDevs() < MAX_DEVELOPERS, 409, `The developer team is full (${MAX_DEVELOPERS} people).`);
    prun("UPDATE developers SET status='active', archived_at=NULL WHERE id=?", d.id); plog(dev.id, 'developer.restore', null, d.phone);
    return { developer: devPublic(pq1('SELECT * FROM developers WHERE id=?', d.id)), active: activeDevs() };
  });

  // ---------------------------------------------------------------- the template every new church is cloned from
  route('GET', '/dev/template', 'dev', () => ({ template: P.getTemplate() }));
  route('POST', '/dev/template', 'dev', ({ dev, body }) => { const t = P.setTemplate(body.template || {}); plog(dev.id, 'template.update', null, JSON.stringify(t).slice(0, 300)); return { template: t }; });

  // ---------------------------------------------------------------- churches
  const stats = (c) => inChurch(c, () => ({
    members: q1("SELECT COUNT(*) n FROM users WHERE archived=0 AND join_status='approved'").n,
    waiting: q1("SELECT COUNT(*) n FROM users WHERE archived=0 AND join_status='pending'").n,
    lastActivity: (q1('SELECT MAX(at) a FROM audit') || {}).a || null,
  }));
  const churchRow = (c, devId) => ({
    id: c.id, number: fmtNumber(c.number), name: c.name, status: c.status, adminPhone: c.admin_phone || '', clonedFrom: c.cloned_from || null,
    district: c.district, station: c.station, conference: c.conference, county: c.county, note: c.note, createdAt: c.created_at,
    ...stats(c), unread: supportUnread(c.id, 'dev:' + devId), isDefault: !!c.is_default,
  });
  route('GET', '/dev/churches', 'dev', ({ dev }) => ({ churches: pq('SELECT * FROM churches ORDER BY name').map((c) => churchRow(c, dev.id)) }));
  route('GET', '/dev/churches/:id', 'dev', ({ dev, params }) => {
    const c = churchOf(params.id); must(c, 404, 'Church not found.');
    return { church: churchRow(c, dev.id), settings: P.settingsOf(c), bindings: pq("SELECT COUNT(*) n FROM bindings WHERE church_id=? AND status='active'", c.id)[0].n, history: pq('SELECT at,by,action,detail FROM paudit WHERE church_id=? ORDER BY at DESC LIMIT 50', c.id) };
  });

  // ---------------------------------------------------------------- reports for the developers: church health and monthly usage
  // COUNTS ONLY. A developer never sees a church's money, minutes, notices or member names here: just whether the church is alive and using the app.
  const KE = 3 * 3600e3;
  const monthRange = (m) => { const [y, mo] = m.split('-').map(Number); return [new Date(Date.UTC(y, mo - 1, 1) - KE).toISOString(), new Date(Date.UTC(y, mo, 1) - KE).toISOString()]; };
  const kenyaMonth = () => new Date(Date.now() + KE).toISOString().slice(0, 7);
  const daysSince = (iso) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400e3) : null);
  const healthOf = (c, adminIn, lastActivity) => {
    if (c.status === 'archived') return 'archived'; if (c.status === 'suspended') return 'paused';
    if (!adminIn) return 'setup';
    const d = daysSince(lastActivity || c.created_at); return d <= 14 ? 'active' : d <= 60 ? 'quiet' : 'dormant';
  };
  const usageOf = (c, lo, hi) => inChurch(c, () => {
    const n = (sql, ...a) => q1(sql, ...a).n;
    const rec = (col) => n("SELECT COUNT(*) n FROM records WHERE col=? AND created_at>=? AND created_at<?", col, lo, hi);
    return {
      members: n("SELECT COUNT(*) n FROM users WHERE archived=0 AND join_status='approved'"), waiting: n("SELECT COUNT(*) n FROM users WHERE archived=0 AND join_status='pending'"),
      archivedMembers: n('SELECT COUNT(*) n FROM users WHERE archived=1'),
      adminIn: n("SELECT COUNT(*) n FROM users WHERE role='church_admin' AND archived=0") > 0,
      withPush: n('SELECT COUNT(DISTINCT user_id) n FROM push_tokens WHERE active=1'),
      lastActivity: (q1('SELECT MAX(at) a FROM audit') || {}).a || null,
      newMembers: n('SELECT COUNT(*) n FROM users WHERE created_at>=? AND created_at<?', lo, hi),
      payments: rec('payments'), receipts: rec('receipts'), notices: rec('notices'), activities: rec('activities'), sermons: rec('sermons'), attendance: n("SELECT COUNT(*) n FROM records WHERE col='office' AND json_extract(data,'$.kind')='attendance' AND created_at>=? AND created_at<?", lo, hi),
      actions: n('SELECT COUNT(*) n FROM audit WHERE at>=? AND at<?', lo, hi),
    };
  });
  const supportCounts = (c, lo, hi, devId) => ({
    messagesFromChurch: pq("SELECT COUNT(*) n FROM support_messages WHERE church_id=? AND from_kind='admin' AND at>=? AND at<?", c.id, lo, hi)[0].n,
    messagesFromDevelopers: pq("SELECT COUNT(*) n FROM support_messages WHERE church_id=? AND from_kind='developer' AND at>=? AND at<?", c.id, lo, hi)[0].n,
    unread: supportUnread(c.id, 'dev:' + devId),
  });
  route('GET', '/dev/reports/health', 'dev', ({ dev, query }) => {
    const month = query.get('month') || kenyaMonth(); must(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), 400, 'Choose a month like 2026-10.');
    const [lo, hi] = monthRange(month);
    const rows = pq('SELECT * FROM churches ORDER BY name').map((c) => {
      const u = usageOf(c, lo, hi); const sp = supportCounts(c, lo, hi, dev.id); const health = healthOf(c, u.adminIn, u.lastActivity);
      const attention = [];
      if (health === 'setup') attention.push('The church admin has not signed in yet.');
      if (health === 'quiet') attention.push('No activity for over 2 weeks.');
      if (health === 'dormant') attention.push('No activity for over 2 months.');
      if (u.waiting >= 5) attention.push(`${u.waiting} people are waiting to join.`);
      if (sp.unread) attention.push(`${sp.unread} unread support message${sp.unread > 1 ? 's' : ''}.`);
      return { id: c.id, number: fmtNumber(c.number), name: c.name, status: c.status, health, lastActivity: u.lastActivity, daysQuiet: daysSince(u.lastActivity || c.created_at), ...u, support: sp, attention };
    });
    const sum = (f) => rows.reduce((t, r) => t + f(r), 0); const cnt = (h) => rows.filter((r) => r.health === h).length;
    const totals = { churches: rows.length, active: cnt('active'), quiet: cnt('quiet'), dormant: cnt('dormant'), setup: cnt('setup'), paused: cnt('paused'), archived: cnt('archived'), members: sum((r) => r.members), waiting: sum((r) => r.waiting), newMembers: sum((r) => r.newMembers), receipts: sum((r) => r.receipts), notices: sum((r) => r.notices), sermons: sum((r) => r.sermons), supportUnread: sum((r) => r.support.unread) };
    const head = ['Church', 'Church number', 'Status', 'Health', 'Members', 'Waiting', 'New members', 'Payments reported', 'Receipts issued', 'Notices', 'Activities', 'Sermon summaries', 'Attendance records', 'Phones with alerts', 'Last activity', 'Support: from church', 'Support: from us'];
    const csv = '﻿' + [csvLine(head), ...rows.map((r) => csvLine([r.name, r.number, r.status, r.health, r.members, r.waiting, r.newMembers, r.payments, r.receipts, r.notices, r.activities, r.sermons, r.attendance, r.withPush, (r.lastActivity || '').slice(0, 10), r.support.messagesFromChurch, r.support.messagesFromDevelopers]))].join('\r\n') + '\r\n';
    return { month, totals, churches: rows, needAttention: rows.filter((r) => r.attention.length && r.status !== 'archived').map((r) => ({ id: r.id, name: r.name, number: r.number, reasons: r.attention })), csv };
  });

  const checkAdminPhone = (phone, churchId) => {
    const ph = normPhone(phone); must(ph, 400, 'Enter a valid Kenyan phone number for the church admin.');
    const b = pq1("SELECT church_id FROM bindings WHERE phone=? AND status='active'", ph);
    must(!b || b.church_id === churchId, 409, 'That phone already belongs to another church. The person must move (or be archived there) first.');
    must(!pq1('SELECT 1 FROM developers WHERE phone=? AND status=\'active\'', ph), 409, 'A developer\'s phone cannot also be a church admin. Use another number.');
    return ph;
  };

  // "Clone the client console and write the church's name on it": a new church is a brand-new, empty, independent database
  // (its own members, money, notices, minutes) that starts with the template settings, or with another church's settings (cloneFrom).
  route('POST', '/dev/churches', 'dev', async ({ dev, body }) => {
    const adminPhone = body.adminPhone ? checkAdminPhone(body.adminPhone, null) : null;
    const c = P.createChurch({ name: body.name, number: body.number, adminPhone, district: body.district, station: body.station, conference: body.conference, county: body.county, cloneFrom: body.cloneFrom || null, by: dev.id, note: body.note });
    if (body.settings) P.saveSettings(c, body.settings);
    if (adminPhone) { try { await sendSms(adminPhone, `You are the Church Admin of ${c.name} on Church Connect. Church number: ${fmtNumber(c.number)}. Install the app, choose Sign up, enter your phone and this church number.`); } catch (e) { console.error('Admin SMS failed:', e.message); } }
    return { church: churchRow(c, dev.id) };
  });
  route('POST', '/dev/churches/:id/update', 'dev', ({ dev, params, body }) => {
    const c = churchOf(params.id); must(c, 404, 'Church not found.');
    const f = {};
    if (body.name !== undefined) { const n = String(body.name).trim().slice(0, 120); must(n.length >= 3, 400, 'Write the church name (at least 3 letters).'); f.name = n; }
    for (const key of ['district', 'station', 'conference', 'county', 'note']) if (typeof body[key] === 'string') f[key] = body[key].trim().slice(0, 120);
    if (Object.keys(f).length) { prun(`UPDATE churches SET ${Object.keys(f).map((x) => x + '=?').join(',')} WHERE id=?`, ...Object.values(f), c.id); plog(dev.id, 'church.update', c.id, JSON.stringify(f)); }
    const c2 = churchOf(c.id);
    // the name is written on every member's profile too
    if (f.name || f.district !== undefined || f.station !== undefined || f.conference !== undefined || f.county !== undefined) inChurch(c2, () => run('UPDATE users SET church=?,district=?,station=?,conference=?,county=?', c2.name, c2.district, c2.station, c2.conference, c2.county));
    if (body.settings) P.saveSettings(c2, body.settings);
    return { church: churchRow(churchOf(c.id), dev.id) };
  });
  // Appoint (or replace) the church admin. The previous admin becomes an ordinary member; nothing is removed.
  route('POST', '/dev/churches/:id/admin', 'dev', async ({ dev, params, body }) => {
    const c = churchOf(params.id); must(c, 404, 'Church not found.');
    const ph = checkAdminPhone(body.phone, c.id); must(ph !== c.admin_phone, 409, 'That person is already the admin.');
    const old = c.admin_phone; prun('UPDATE churches SET admin_phone=? WHERE id=?', ph, c.id);
    inChurch(c, () => {
      if (old) { const o = q1('SELECT * FROM users WHERE phone=?', old); if (o && o.role === 'church_admin') { run("UPDATE users SET role='member', requested_role='member', role_status='approved' WHERE id=?", o.id); log('developer:' + dev.id, 'update', 'users', o.id, 'no longer church admin'); } }
      const n = q1('SELECT * FROM users WHERE phone=? AND archived=0', ph);
      if (n) { run("UPDATE users SET role='church_admin', requested_role='church_admin', role_status='approved', join_status='approved' WHERE id=?", n.id); log('developer:' + dev.id, 'update', 'users', n.id, 'appointed church admin'); }
    });
    plog(dev.id, 'church.admin', c.id, (old || '-') + ' -> ' + ph);
    try { await sendSms(ph, `You are now the Church Admin of ${c.name} on Church Connect. Church number: ${fmtNumber(c.number)}.`); } catch (e) { console.error('Admin SMS failed:', e.message); }
    return { church: churchRow(churchOf(c.id), dev.id) };
  });
  // Pause, archive or bring back a church. Members of a paused/archived church cannot sign in; all data is kept.
  route('POST', '/dev/churches/:id/status', 'dev', ({ dev, params, body }) => {
    const c = churchOf(params.id); must(c, 404, 'Church not found.');
    must(['active', 'suspended', 'archived'].includes(body.status), 400, 'Status must be active, suspended or archived.');
    prun('UPDATE churches SET status=? WHERE id=?', body.status, c.id); plog(dev.id, 'church.' + body.status, c.id, String(body.reason || '').slice(0, 200));
    return { church: churchRow(churchOf(c.id), dev.id) };
  });
  route('GET', '/dev/audit', 'dev', () => ({ entries: pq('SELECT * FROM paudit ORDER BY at DESC LIMIT 200') }));

  // ---------------------------------------------------------------- support chat: one thread per church, shared by the whole developer team
  const msgOut = (m) => ({ id: m.id, from: m.from_kind, name: m.from_name, body: m.body, at: m.at });
  const markRead = (churchId, reader) => prun('INSERT INTO support_reads VALUES(?,?,?) ON CONFLICT(church_id,reader) DO UPDATE SET last_at=excluded.last_at', churchId, reader, now());
  function postMessage(churchId, kind, who, body, ip) {
    const text = String(body || '').trim(); must(text, 400, 'Write a message first.'); must(text.length <= 2000, 400, 'Message is too long (2000 characters).');
    must(!limited('support:' + who.id, 60, 3600e3), 429, 'You are sending too many messages. Please wait a little.');
    const id = uid(), at = now();
    prun('INSERT INTO support_messages VALUES(?,?,?,?,?,?,?)', id, churchId, kind, who.id, who.name || '', text, at);
    return { id, from: kind, name: who.name || '', body: text, at };
  }
  route('GET', '/dev/support', 'dev', ({ dev }) => {
    const threads = pq('SELECT c.id, c.name, c.number, c.status FROM churches c ORDER BY c.name').map((c) => {
      const last = pq1('SELECT * FROM support_messages WHERE church_id=? ORDER BY at DESC LIMIT 1', c.id);
      return { churchId: c.id, church: c.name, number: fmtNumber(c.number), unread: supportUnread(c.id, 'dev:' + dev.id), last: last ? msgOut(last) : null };
    }).filter((t) => t.last);
    threads.sort((a, b) => (b.last.at > a.last.at ? 1 : -1));
    return { threads, unread: threads.reduce((s, t) => s + t.unread, 0) };
  });
  route('GET', '/dev/support/:churchId', 'dev', ({ dev, params, query }) => {
    must(churchOf(params.churchId), 404, 'Church not found.');
    const after = query.get('after') || '';
    const msgs = pq('SELECT * FROM support_messages WHERE church_id=? AND at>? ORDER BY at LIMIT 500', params.churchId, after).map(msgOut);
    if (query.get('read') !== '0') markRead(params.churchId, 'dev:' + dev.id);
    return { messages: msgs };
  });
  route('POST', '/dev/support/:churchId', 'dev', ({ dev, params, body, ip }) => {
    const c = churchOf(params.churchId); must(c, 404, 'Church not found.');
    const m = postMessage(c.id, 'developer', { id: dev.id, name: dev.name }, body.body, ip); markRead(c.id, 'dev:' + dev.id);
    inChurch(c, () => notifyAdmins('chat_admin', { text: String(body.body || '').slice(0, 120) }, { screen: 'support' })); // phone buzzes: the developers answered
    return { message: m };
  });

  // ---------------------------------------------------------------- Church Admin
  const isAdmin = (me) => actor(me).eff === 'church_admin';
  const adminOnly = (me) => must(isAdmin(me), 403, 'Only the Church Admin can do this.');
  const memberRow = (u) => ({ ...publicUser(u), joinStatus: u.join_status, archived: !!u.archived, createdAt: u.created_at });

  route('GET', '/admin/overview', true, ({ me }) => {
    adminOnly(me); const c = ctx().church;
    return {
      church: { id: c.id, name: c.name, number: fmtNumber(c.number), district: c.district, station: c.station, conference: c.conference, county: c.county, status: c.status },
      settings: P.settingsOf(c),
      counts: {
        members: q1("SELECT COUNT(*) n FROM users WHERE archived=0 AND join_status='approved'").n,
        waitingToJoin: q1("SELECT COUNT(*) n FROM users WHERE archived=0 AND join_status='pending'").n,
        rolesToVerify: q1("SELECT COUNT(*) n FROM users WHERE archived=0 AND join_status='approved' AND role_status='pending'").n,
        archivedMembers: q1('SELECT COUNT(*) n FROM users WHERE archived=1').n,
        activities: q1("SELECT COUNT(*) n FROM records WHERE col='activities' AND archived=0").n,
      },
      supportUnread: supportUnread(c.id, 'admin'),
    };
  });
  route('GET', '/admin/members', true, ({ me, query }) => {
    adminOnly(me); const inc = query.get('archived') === '1';
    return { members: q(`SELECT * FROM users ${inc ? '' : 'WHERE archived=0'} ORDER BY archived, join_status DESC, name`).map(memberRow) };
  });

  // Add a member directly (for people who have no smartphone yet, or to prepare the church before launch).
  // They later sign in with the same phone number: it is already bound to this church, so no church number is needed.
  const addMember = (me, body) => {
    const c = ctx().church;
    const phone = normPhone(body.phone); must(phone, 400, 'Enter a valid Kenyan phone number.');
    const name = String(body.name || '').trim(); must(name.length >= 2, 400, 'Write the member\'s name.');
    const role = body.role && body.role !== 'member' ? body.role : 'member';
    must(role === 'member' || role === 'former_leader' || LEADER_ROLES.includes(role), 400, 'Unknown role.');
    const bound = pq1("SELECT church_id FROM bindings WHERE phone=? AND status='active'", phone);
    must(!bound, 409, bound && bound.church_id === c.id ? 'That person is already a member of this church.' : 'That phone already belongs to another church. The person must move to your church with your church number.');
    must(!pq1("SELECT 1 FROM developers WHERE phone=? AND status='active'", phone), 409, 'That number is reserved.');
    const groups = Array.isArray(body.groups) ? body.groups.filter((g) => typeof g === 'string').slice(0, 10) : [];
    const ex = q1('SELECT * FROM users WHERE phone=?', phone); let id;
    if (ex) { id = ex.id; run("UPDATE users SET name=?,role=?,requested_role=?,role_status='approved',groups=?,archived=0,join_status='approved',church=? WHERE id=?", name, role, role, JSON.stringify(groups), c.name, id); log(me.id, 'unarchive', 'users', id, 'added again by church admin'); }
    else {
      id = uid();
      run("INSERT INTO users(id,phone,name,id_number,membership_number,requested_role,role,role_status,former_roles,groups,church,district,station,conference,county,created_at,join_status) VALUES(?,?,?,?,?,?,?,'approved','[]',?,?,?,?,?,?,?,'approved')",
        id, phone, name, String(body.idNumber || '').trim(), body.membershipNumber || null, role, role, JSON.stringify(groups), c.name, c.district || '', c.station || '', c.conference || '', c.county || '', now());
      log(me.id, 'create', 'users', id, 'added by church admin' + (role !== 'member' ? ' as ' + role : ''));
    }
    prun('INSERT INTO bindings VALUES(?,?,?,?,?,?,NULL,NULL)', uid(), phone, c.id, id, 'active', now()); plog(me.id, 'binding.create', c.id, phone + ' (added by admin)');
    return { member: memberRow(q1('SELECT * FROM users WHERE id=?', id)) };
  };
  route('POST', '/admin/members', true, ({ me, body }) => { adminOnly(me); return addMember(me, body); });

  // ---- bulk tools: export, import (preview first), printable directory. All admin-only; nothing is deleted.
  const roleLbl = (lang) => (k) => k === 'member' ? (lang === 'sw' ? 'Mshiriki' : 'Member') : k === 'former_leader' ? (lang === 'sw' ? 'Kiongozi wa Zamani (Mshauri)' : 'Former Leader (Advisor)') : roleName(k, lang);
  const grpLbl = (lang) => (g) => (GROUP_NAMES[g] ? GROUP_NAMES[g][lang === 'sw' ? 1 : 0] : g);
  const asMember = (m) => ({ name: m.name, phone: m.phone, role: m.role, idNumber: m.idNumber, membershipNumber: m.membershipNumber, groups: m.groups, archived: m.archived, joinStatus: m.joinStatus, createdAt: m.createdAt });
  route('GET', '/admin/members/export', true, ({ me, query }) => {
    adminOnly(me); const lang = query.get('lang') === 'sw' ? 'sw' : 'en'; const inc = query.get('archived') === '1';
    const list = q(`SELECT * FROM users ${inc ? '' : 'WHERE archived=0'} ORDER BY archived, name`).map(memberRow).map(asMember);
    log(me.id, 'export', 'users', '', `member list (${list.length})`);
    return { count: list.length, csv: memberCsv(list, roleLbl(lang), grpLbl(lang)) };
  });
  route('GET', '/admin/directory', true, ({ me, query }) => {
    adminOnly(me); const lang = query.get('lang') === 'sw' ? 'sw' : 'en';
    const list = q("SELECT * FROM users WHERE archived=0 AND join_status='approved' ORDER BY name").map(memberRow);
    const text = directoryText({ church: ctx().church.name, members: list.map(asMember), roleLabel: roleLbl(lang), sw: lang === 'sw', phones: query.get('phones') !== '0' });
    log(me.id, 'export', 'users', '', `directory (${list.length})`);
    return { count: list.length, text };
  });
  // body: { csv, commit }. Without commit it only checks every row and says what WOULD happen; with commit it adds the good rows.
  route('POST', '/admin/members/import', true, ({ me, body }) => {
    adminOnly(me);
    let rows; try { rows = readImport(String(body.csv || '').slice(0, 400000), LEADER_ROLES); } catch (e) { throw new HttpError(400, e.message); }
    const seen = new Set(); const results = [];
    for (const r of rows) {
      const out = { line: r.line, name: r.name, phone: r.phone, role: r.role, status: 'ready', problem: '' };
      const phone = normPhone(r.phone);
      if (r.name.length < 2) { out.status = 'skipped'; out.problem = "Write the member's name."; }
      else if (!phone) { out.status = 'skipped'; out.problem = 'Enter a valid Kenyan phone number.'; }
      else if (r.role === null) { out.status = 'skipped'; out.problem = 'Unknown role.'; out.problem += ' (' + r.roleText + ')'; }
      else if (seen.has(phone)) { out.status = 'skipped'; out.problem = 'This phone number appears twice in the file.'; }
      else {
        seen.add(phone); out.phone = phone;
        const bound = pq1("SELECT church_id FROM bindings WHERE phone=? AND status='active'", phone);
        if (bound) { out.status = 'skipped'; out.problem = bound.church_id === ctx().church.id ? 'That person is already a member of this church.' : 'That phone already belongs to another church. The person must move to your church with your church number.'; }
        else if (pq1("SELECT 1 FROM developers WHERE phone=? AND status='active'", phone)) { out.status = 'skipped'; out.problem = 'That number is reserved.'; }
        else if (body.commit) {
          try { addMember(me, { name: r.name, phone, role: r.role, idNumber: r.idNumber, membershipNumber: r.membershipNumber || undefined, groups: r.groups }); out.status = 'added'; }
          catch (e) { out.status = 'skipped'; out.problem = e.message || 'Not done.'; }
        }
      }
      if (r.groupsUnknown.length) out.note = 'Unknown groups ignored: ' + r.groupsUnknown.join(', ');
      results.push(out);
    }
    const count = (s) => results.filter((x) => x.status === s).length;
    if (body.commit) log(me.id, 'import', 'users', '', `${count('added')} added, ${count('skipped')} skipped`);
    return { committed: !!body.commit, ready: count('ready'), added: count('added'), skipped: count('skipped'), results };
  });
  // People who typed the church number wait here until the admin lets them in (or turns them away).
  route('POST', '/admin/members/:id/join', true, ({ me, params, body }) => {
    adminOnly(me); const u = q1('SELECT * FROM users WHERE id=? AND archived=0', params.id); must(u, 404, 'No such member.');
    must(u.join_status === 'pending', 409, 'This person is not waiting for approval.');
    if (body.approve) { run("UPDATE users SET join_status='approved' WHERE id=?", u.id); log(me.id, 'update', 'users', u.id, 'join approved'); notifyUsers([u.id], 'join', { church: ctx().church.name }, { screen: 'home' }); }
    else archiveUser(me, u.id, 'join declined by church admin');
    return { member: memberRow(q1('SELECT * FROM users WHERE id=?', u.id)) };
  });
  // "Delete" = archive. The person's phone is released so they can join or be added by another church; their records stay here.
  route('POST', '/admin/members/:id/archive', true, ({ me, params, body }) => {
    adminOnly(me); must(params.id !== me.id, 403, 'You cannot archive your own account.');
    const u = q1('SELECT * FROM users WHERE id=?', params.id); must(u && !u.archived, 404, 'No such member.');
    archiveUser(me, u.id, String(body.reason || 'archived by church admin').slice(0, 200)); return { archived: true };
  });
  route('POST', '/admin/members/:id/restore', true, ({ me, params }) => {
    adminOnly(me); const c = ctx().church;
    const u = q1('SELECT * FROM users WHERE id=?', params.id); must(u && u.archived, 404, 'No archived member found.');
    const bound = pq1("SELECT church_id FROM bindings WHERE phone=? AND status='active'", u.phone); must(!bound, 409, 'That person has since joined a church, so they cannot be restored here.');
    run("UPDATE users SET archived=0, join_status='approved' WHERE id=?", u.id); log(me.id, 'unarchive', 'users', u.id, 'restored by church admin');
    prun('INSERT INTO bindings VALUES(?,?,?,?,?,?,NULL,NULL)', uid(), u.phone, c.id, u.id, 'active', now()); plog(me.id, 'binding.create', c.id, u.phone + ' (restored)');
    return { member: memberRow(q1('SELECT * FROM users WHERE id=?', u.id)) };
  });
  // Set a member's position/groups directly (the admin is a verifier, so the role is approved at once).
  route('POST', '/admin/members/:id/role', true, ({ me, params, body }) => {
    adminOnly(me); must(params.id !== me.id, 403, 'You cannot change your own role.');
    const u = q1('SELECT * FROM users WHERE id=? AND archived=0', params.id); must(u, 404, 'No such member.');
    const role = body.role || 'member'; must(role === 'member' || role === 'former_leader' || LEADER_ROLES.includes(role), 400, 'Unknown role.');
    const groups = Array.isArray(body.groups) ? body.groups.filter((g) => typeof g === 'string').slice(0, 10) : JSON.parse(u.groups);
    run("UPDATE users SET role=?, requested_role=?, role_status='approved', groups=? WHERE id=?", role, role, JSON.stringify(groups), u.id); log(me.id, 'update', 'users', u.id, 'role set: ' + role);
    return { member: memberRow(q1('SELECT * FROM users WHERE id=?', u.id)) };
  });
  route('POST', '/admin/settings', true, ({ me, body }) => {
    adminOnly(me); const s = P.saveSettings(ctx().church, body.settings || {}); log(me.id, 'update', 'settings', '', JSON.stringify(s).slice(0, 300)); return { settings: s };
  });

  // Support widget (church side)
  route('GET', '/admin/support', true, ({ me, query }) => {
    adminOnly(me); const c = ctx().church; const after = query.get('after') || '';
    const msgs = pq('SELECT * FROM support_messages WHERE church_id=? AND at>? ORDER BY at LIMIT 500', c.id, after).map(msgOut);
    if (query.get('read') !== '0') markRead(c.id, 'admin');
    return { messages: msgs, unread: supportUnread(c.id, 'admin') };
  });
  route('POST', '/admin/support', true, ({ me, body, ip }) => {
    adminOnly(me); const c = ctx().church;
    const m = postMessage(c.id, 'admin', { id: me.id, name: me.name }, body.body, ip); markRead(c.id, 'admin'); return { message: m };
  });

  // ---------------------------------------------------------------- the developer console page
  route('GET', '/console', false, () => {
    const file = path.join(here, 'console.html');
    return { __html: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '<!doctype html><p>Developer console page is missing (server/console.html).' };
  });
}
