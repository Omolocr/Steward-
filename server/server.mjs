// Church Connect backend – zero dependencies (Node 22+, built-in SQLite).
// Archive-only: there is no delete route, and SQLite triggers refuse DELETE on every table that holds church data.
//
// Run:  BOOTSTRAP="0711111111:secretary,0722222222:pastor" node --no-warnings server.mjs
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fmtNumber, normNumber, openPlatform, validNumber } from './platform.mjs';
import { installConsole } from './console-api.mjs';
import { errText, roleName, normLang, otpSms, pushText, receiptSms, receiptText as receiptTextL, reqLang, roleSms } from './messages.mjs';
import { installClerkTools } from './clerks.mjs';
import { installSandbox } from './sandbox.mjs';
import { ServiceError, aiConfigured, sendPush, validPushToken, sendSms, smsConfigured, summarizeGeneral, summarizeKids, summarizeQuick, targets, transcribeAudio, wordCount } from './providers.mjs';

const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || (process.env.DB_FILE ? path.dirname(path.resolve(process.env.DB_FILE)) : '.');
fs.mkdirSync(DATA_DIR, { recursive: true });
const LEGACY_DB = process.env.DB_FILE || path.join(DATA_DIR, 'church.db'); // a single-church database from before multi-church support
const DEFAULT_CHURCH = (process.env.DEFAULT_CHURCH || '').trim(); // single-church mode: anyone without a church number joins this church
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_MB || 300) * 1024 * 1024;
const SECRET = process.env.TOKEN_SECRET || 'dev-secret-change-me';
const DEV = process.env.NODE_ENV !== 'production'; // dev: OTP is returned in the response and logged
const PERSISTENT = process.env.PERSISTENT_STORAGE === 'yes';
const EPHEMERAL_OK = process.env.ALLOW_EPHEMERAL === 'yes';
const SANDBOX = process.env.SANDBOX_ACCESS === 'yes'; // team quick entry: reserved test numbers sign in without an SMS code (made-up data only)
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // set to 1 when running behind Caddy/Nginx so the real client IP is used for rate limits

// Refuse to start in production with unsafe settings.
if (!DEV) {
  const problems = [];
  if (SECRET === 'dev-secret-change-me' || SECRET.length < 32) problems.push('TOKEN_SECRET must be set to a random string of at least 32 characters');
  if (process.env.MPESA_CALLBACK_SECRET && process.env.MPESA_CALLBACK_SECRET.length < 32) problems.push('MPESA_CALLBACK_SECRET must be at least 32 characters (use only 0-9 and a-f; make one with: openssl rand -hex 32)');
  if (!smsConfigured()) problems.push('SMS is not configured (SMS_PROVIDER=africastalking, AT_USERNAME, AT_API_KEY)');
  if (problems.length) { console.error('Cannot start in production:\n - ' + problems.join('\n - ')); process.exit(1); }
}
const BOOTSTRAP = Object.fromEntries((process.env.BOOTSTRAP || '').split(',').filter(Boolean).map((x) => x.split(':'))); // phone -> role, auto-approved

// ---------------------------------------------------------------- roles (mirror of the app's constants)
const LEADER_ROLES = ['pastor', 'treasurer', 'secretary', 'clerk', 'sabbath_school', 'education', 'elder1', 'elder2', 'elder3', 'elder4',
  'camp_secretary', 'camp_chair', 'camp_clerk', 'building', 'special', 'dorcas_leader', 'men_leader', 'youth_leader', 'pathfinder_leader', 'adventurer_leader', 'choir_leader'];
const LEADS = { dorcas_leader: 'dorcas', men_leader: 'men', youth_leader: 'youth', pathfinder_leader: 'pathfinders', adventurer_leader: 'adventurers', choir_leader: 'choir' };
const CAMP = ['camp_secretary', 'camp_chair', 'camp_clerk'];
const COLLECTIONS = ['notices', 'payments', 'receipts', 'memberships', 'welfare', 'projects', 'minutes', 'care', 'sermons', 'activities', 'office', 'campreg'];

// ---------------------------------------------------------------- databases
// platform.db knows the churches; every church has its own database file. A request runs inside one church's context
// (AsyncLocalStorage), and q/q1/run/db below always talk to THAT church's database, so one church can never read another's data.
const P = openPlatform(DATA_DIR);
const { pq, pq1, prun, plog } = P;
const als = new AsyncLocalStorage();
const ctx = () => { const s = als.getStore(); if (!s || !s.church) throw new Error('No church selected for this request'); return s; };
const db = { exec: (sql) => ctx().db.exec(sql), prepare: (sql) => ctx().db.prepare(sql) };
const inChurch = (c, fn) => als.run({ church: c, db: P.churchDb(c) }, fn);
const churchOf = (id) => pq1('SELECT * FROM churches WHERE id=?', id);
const churchByNumber = (n) => (validNumber(n) ? pq1('SELECT * FROM churches WHERE number=?', normNumber(n)) : null);
const churchName = () => ctx().church.name;
const q = (sql, ...a) => db.prepare(sql).all(...a);
const q1 = (sql, ...a) => db.prepare(sql).get(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const uid = () => crypto.randomBytes(9).toString('base64url');
const now = () => new Date().toISOString();
const log = (by, action, col, rid, detail = '') => run('INSERT INTO audit VALUES(?,?,?,?,?,?,?)', uid(), now(), by, action, col, rid, detail);
const nextNo = (name) => { run('INSERT INTO counters VALUES(?,1) ON CONFLICT(name) DO UPDATE SET n=n+1', name); return q1('SELECT n FROM counters WHERE name=?', name).n; };

// Single-church mode: make sure the default church exists (adopting an older single-church database if there is one).
let defaultChurch = null;
if (DEFAULT_CHURCH) {
  defaultChurch = pq1('SELECT * FROM churches WHERE is_default=1');
  if (!defaultChurch) {
    const legacy = fs.existsSync(LEGACY_DB) || !!process.env.DB_FILE;
    defaultChurch = P.createChurch({ name: DEFAULT_CHURCH, number: process.env.DEFAULT_CHURCH_NUMBER, by: 'system', isDefault: true, dbFile: legacy ? path.resolve(LEGACY_DB) : undefined });
    if (legacy) inChurch(defaultChurch, () => { // people who already existed become bound to this church
      for (const u of q('SELECT id, phone FROM users WHERE archived=0')) prun('INSERT OR IGNORE INTO bindings VALUES(?,?,?,?,?,?,NULL,NULL)', uid(), u.phone, defaultChurch.id, u.id, 'active', now());
    });
  }
}

// ---------------------------------------------------------------- auth (phone OTP + signed tokens)
const hash = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const normPhone = (p) => { const d = String(p || '').replace(/[^\d+]/g, ''); if (/^\+254\d{9}$/.test(d)) return '0' + d.slice(4); if (/^254\d{9}$/.test(d)) return '0' + d.slice(3); return /^0\d{9}$/.test(d) ? d : null; };
const sign = (payload) => { const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); return b + '.' + hash(b); };
const verifyToken = (t) => {
  const [b, s] = String(t || '').split('.');
  if (!b || !s || !crypto.timingSafeEqual(Buffer.from(hash(b)), Buffer.from(s.padEnd(64, '0').slice(0, 64)))) return null;
  const p = JSON.parse(Buffer.from(b, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
};
const publicUser = (u) => u && ({ id: u.id, name: u.name, phone: u.phone, role: u.role, requestedRole: u.requested_role, roleStatus: u.role_status, formerRoles: JSON.parse(u.former_roles), groups: JSON.parse(u.groups), church: u.church, district: u.district, station: u.station, conference: u.conference, county: u.county, membershipNumber: u.membership_number, guideSeen: u.guide_seen || '' });
// The effective role: a leader whose role is not yet approved acts as a plain member. Members with old positions act as advisors.
const effRole = (u) => (u.role_status !== 'approved' ? 'member' : u.role);
const actor = (u) => ({ ...u, eff: effRole(u), groupsArr: JSON.parse(u.groups) });

// ---------------------------------------------------------------- permission policy (server side – the real enforcement)
const isLeader = (a) => LEADER_ROLES.includes(a.eff);
const isElder = (a) => /^elder/.test(a.eff);
const led = (a) => LEADS[a.eff];
const isIn = (a, ...r) => r.includes(a.eff);
const inGroup = (a, g) => led(a) === g || a.groupsArr.includes(g);

const policy = {
  create(col, a, d) {
    switch (col) {
      case 'notices':
        if (d.board === 'church') return isLeader(a) || a.eff === 'church_admin';
        if (d.board === 'camp') return CAMP.includes(a.eff) || a.eff === 'pastor';
        if (d.board === 'group') return !!d.groupKey && (led(a) === d.groupKey || isLeader(a) || a.groupsArr.includes(d.groupKey));
        return false;
      case 'payments': return true;
      case 'campreg': return true; // anyone may register themselves; the route decides what a non-officer may set
      case 'receipts': return false; // only through /payments/:id/receive
      case 'memberships': return isIn(a, 'secretary', 'clerk');
      case 'welfare': return isIn(a, 'treasurer', 'secretary', 'pastor', 'dorcas_leader');
      case 'projects': return isIn(a, 'building', 'treasurer');
      case 'minutes': return isIn(a, 'secretary');
      case 'care': return a.eff === 'pastor' || isElder(a);
      case 'sermons': return isIn(a, 'pastor', 'secretary') || isElder(a);
      case 'activities': return !!d.groupKey && (led(a) === d.groupKey || a.eff === d.groupKey || isIn(a, 'pastor', 'secretary', 'church_admin'));
      case 'office': return isLeader(a) && d.office === a.eff; // each leader keeps records for their own office only
    }
    return false;
  },
  read(col, a, r, d) {
    switch (col) {
      case 'notices':
        if (d.board === 'group') {
          const viewer = led(a) === d.groupKey || a.groupsArr.includes(d.groupKey) || isLeader(a) || a.eff === 'former_leader' || a.eff === 'church_admin';
          if (!viewer) return false;
          if (d.status === 'pending') return led(a) === d.groupKey || r.created_by === a.id;
        }
        return true;
      case 'payments': return isIn(a, 'treasurer', 'pastor') || r.created_by === a.id;
      case 'receipts': return a.eff === 'treasurer' || d.memberId === a.id;
      case 'memberships': return isIn(a, 'secretary', 'clerk', 'pastor') || isElder(a) || r.created_by === a.id; // an applicant can see their own application
      case 'welfare': return isLeader(a) || a.eff === 'former_leader'; // every leader (and former leader, as adviser) can see the funds; only the managers can add
      case 'minutes': return isIn(a, 'secretary', 'pastor', 'clerk') || isElder(a);
      case 'activities': return inGroup(a, d.groupKey) || isLeader(a) || a.eff === 'former_leader' || a.eff === 'church_admin';
      case 'office': return d.office === a.eff || isIn(a, 'pastor', 'secretary'); // the owner, plus Pastor and Secretary who oversee all offices
      case 'campreg': return CAMP.includes(a.eff) || a.eff === 'pastor' || r.created_by === a.id; // camp officers and the Pastor see everyone; a person sees their own
      default: return true; // projects, care, sermons: open to the congregation
    }
  },
  archive(col, a, r, d) {
    switch (col) {
      case 'notices':
        if (d.board === 'church') return isIn(a, 'secretary', 'church_admin');
        if (d.board === 'group') return led(a) === d.groupKey || isIn(a, 'secretary', 'church_admin');
        return isIn(a, 'camp_secretary', 'pastor');
      case 'payments': case 'receipts': return a.eff === 'treasurer';
      case 'memberships': return isIn(a, 'secretary', 'clerk');
      case 'welfare': return isIn(a, 'treasurer', 'secretary', 'pastor', 'dorcas_leader');
      case 'projects': return isIn(a, 'building', 'treasurer');
      case 'minutes': return a.eff === 'secretary';
      case 'care': case 'sermons': return a.eff === 'pastor';
      case 'activities': return led(a) === d.groupKey || a.eff === d.groupKey || isIn(a, 'secretary', 'church_admin');
      case 'office': return d.office === a.eff;
      case 'campreg': return CAMP.includes(a.eff); // camp officers cancel (archive) registrations
    }
    return false;
  },
  restore: (a, col) => isIn(a, 'secretary', 'pastor') || (a.eff === 'church_admin' && (col === undefined || ['notices', 'activities'].includes(col))), // the church admin only brings back posts and activities, never money or minutes
};

// ---------------------------------------------------------------- payments: the "system AI" split
const round2 = (n) => Math.round(n * 100) / 100;
function calculateSplit(amount, rows) {
  const clean = (rows || []).filter((r) => r && r.category && Number(r.percent) > 0);
  if (!(amount > 0)) return { error: 'Enter the amount paid.' };
  if (!clean.length) return { error: 'Add at least one category.' };
  const total = round2(clean.reduce((s, r) => s + Number(r.percent), 0));
  if (total !== 100) return { error: `Percentages add up to ${total}%. They must add up to 100%.` };
  let used = 0;
  return { allocations: clean.map((r, i) => { const amt = i === clean.length - 1 ? round2(amount - used) : round2((amount * r.percent) / 100); used = round2(used + amt); return { category: String(r.category), percent: Number(r.percent), amount: amt }; }) };
}
const ksh = (n) => 'KSh ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });

// ---------------------------------------------------------------- helpers
const out = (r) => ({ id: r.id, ...JSON.parse(r.data), createdBy: r.created_by, createdAt: r.created_at, archived: !!r.archived, archivedAt: r.archived_at, archivedBy: r.archived_by, archiveReason: r.archive_reason });
const insertRec = (col, data, by) => { const id = uid(); run('INSERT INTO records(id,col,data,created_by,created_at) VALUES(?,?,?,?,?)', id, col, JSON.stringify(data), by, now()); log(by, 'create', col, id); return id; };
const getRec = (col, id) => q1('SELECT * FROM records WHERE col=? AND id=?', col, id);
const setData = (id, data, by, detail) => { run('UPDATE records SET data=? WHERE id=?', JSON.stringify(data), id); log(by, 'update', '', id, detail); };
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const must = (cond, code, msg) => { if (!cond) throw new HttpError(code, msg); };

// ---------------------------------------------------------------- office tools: Sabbath School attendance, building pledges, camp registration
const int = (v, max = 100000) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= max ? n : null; };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(v));
// Returns the cleaned office record. Only the office's owner can reach this (policy.create), and the shape is checked here.
function cleanOffice(d) {
  const base = { office: d.office, kind: String(d.kind || '').slice(0, 40), title: String(d.title || '').slice(0, 200), date: d.date ? String(d.date).slice(0, 10) : '', body: String(d.body || '').slice(0, 4000) };
  if (d.office === 'sabbath_school' && d.kind === 'attendance') {
    must(isDate(d.date), 400, 'Choose the Sabbath date.');
    must(Array.isArray(d.classes) && d.classes.length >= 1 && d.classes.length <= 12, 400, 'Add at least one class.');
    const classes = d.classes.map((c) => { const enrolled = int(c && c.enrolled), present = int(c && c.present); must(String(c && c.name || '').trim() && enrolled !== null && present !== null, 400, 'Each class needs a name, the number on the roll and the number present.'); must(present <= enrolled, 400, 'More people present than on the roll in ' + String(c.name).slice(0, 40) + '.'); return { name: String(c.name).trim().slice(0, 40), enrolled, present }; });
    const visitors = int(d.visitors ?? 0); must(visitors !== null, 400, 'Visitors must be a number.');
    must(!q1("SELECT 1 FROM records WHERE col='office' AND archived=0 AND json_extract(data,'$.kind')='attendance' AND json_extract(data,'$.date')=?", d.date), 409, 'Attendance for that Sabbath is already recorded. Archive it first to record it again.');
    return { ...base, kind: 'attendance', title: 'Sabbath School attendance – ' + d.date, classes, visitors, lesson: String(d.lesson || '').slice(0, 200) };
  }
  if (d.office === 'building' && d.kind === 'pledge') {
    const amount = Number(d.amount); must(String(d.pledger || '').trim() && amount > 0 && amount <= 1e9, 400, 'Write the name and the amount pledged.');
    must(!d.due || isDate(d.due), 400, 'Choose a valid due date.');
    return { ...base, kind: 'pledge', title: 'Pledge – ' + String(d.pledger).trim().slice(0, 100), pledger: String(d.pledger).trim().slice(0, 100), phone: String(d.phone || '').slice(0, 20), amount: Math.round(amount * 100) / 100, due: d.due || '' };
  }
  if (d.office === 'building' && d.kind === 'pledge_payment') {
    const pl = getRec('office', d.pledgeId); const pd = pl && JSON.parse(pl.data);
    must(pl && !pl.archived && pd.office === 'building' && pd.kind === 'pledge', 404, 'Pledge not found.');
    const amount = Number(d.amount); must(amount > 0 && amount <= 1e9, 400, 'Enter the amount paid.');
    must(!d.date || isDate(d.date), 400, 'Choose a valid date.');
    return { ...base, kind: 'pledge_payment', title: 'Payment – ' + pd.pledger, pledgeId: pl.id, pledger: pd.pledger, amount: Math.round(amount * 100) / 100, date: d.date || new Date().toISOString().slice(0, 10), method: String(d.method || '').slice(0, 40) };
  }
  return base;
}
const CAMP_CATEGORIES = ['adult', 'youth', 'child'], CAMP_STAY = ['tent', 'dormitory', 'own', 'day'];
function cleanCamp(d, me, officer) {
  const category = CAMP_CATEGORIES.includes(d.category) ? d.category : 'adult', stay = CAMP_STAY.includes(d.accommodation) ? d.accommodation : 'day';
  const days = int(d.days ?? 1, 30); must(days !== null && days >= 1, 400, 'Days must be a number from 1 to 30.');
  const own = !officer; // a person registering themselves is always registering as themselves
  const name = own ? me.name : String(d.name || '').trim().slice(0, 100); must(name, 400, 'Write the name of the person registering.');
  must(!q1("SELECT 1 FROM records WHERE col='campreg' AND archived=0 AND json_extract(data,'$.camp')=? AND (json_extract(data,'$.memberId')=? OR (json_extract(data,'$.name')=? AND json_extract(data,'$.phone')=?))", String(d.camp || '').trim(), own ? me.id : '-', name, own ? me.phone : String(d.phone || '').slice(0, 20)), 409, 'This person is already registered for this camp meeting.');
  return { camp: String(d.camp || '').trim().slice(0, 100) || 'Camp Meeting', name, phone: own ? me.phone : String(d.phone || '').slice(0, 20), memberId: own ? me.id : null, church: String(d.church || '').slice(0, 100), category, accommodation: stay, days, note: String(d.note || '').slice(0, 300), fee: 0, paid: 0, payments: [], checkedIn: false };
}

// ---------------------------------------------------------------- push notifications (best effort: never blocks or fails the action)
// Must run inside a church context. Builds each person's message in their own language, then sends in the background.
function notifyUsers(userIds, kind, args, data = {}) {
  try {
    const store = ctx(); const msgs = [];
    for (const id of new Set(userIds)) {
      const u = q1("SELECT lang FROM users WHERE id=? AND archived=0 AND join_status='approved'", id); if (!u) continue;
      const t = pushText(u.lang, kind, args);
      for (const k of q('SELECT token FROM push_tokens WHERE user_id=? AND active=1', id)) msgs.push({ to: k.token, title: t.title, body: String(t.body).slice(0, 200), data: { kind, ...data } });
    }
    if (!msgs.length) return;
    sendPush(msgs).then(({ invalid }) => { if (invalid.length) als.run(store, () => { for (const t of invalid) run('UPDATE push_tokens SET active=0, updated_at=? WHERE token=?', now(), t); }); })
      .catch((e) => console.error('Push failed:', e.message));
  } catch (e) { console.error('Push failed:', e.message); }
}
const usersWhere = (fn) => q("SELECT * FROM users WHERE archived=0 AND join_status='approved' AND role_status='approved'").filter((u) => fn(actor(u), u));
const notifyRole = (role, kind, args, data) => notifyUsers(usersWhere((a) => a.eff === role).map((u) => u.id), kind, args, data);
const notifyAdmins = (kind, args, data) => notifyRole('church_admin', kind, args, data);
function notifyNotice(recId, d, authorId) {
  const r = getRec('notices', recId);
  const ids = usersWhere((a, u) => u.id !== authorId && policy.read('notices', a, r, d)).map((u) => u.id);
  notifyUsers(ids, 'notice', { board: d.board, groupKey: d.groupKey, title: d.title }, { screen: d.board === 'church' ? 'church' : d.board === 'camp' ? 'camp' : 'group' });
}

// ---------------------------------------------------------------- routes
const routes = [];
const route = (method, pattern, auth, fn, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), auth, fn, raw: !!opts.raw, pendingOk: !!opts.pendingOk });

// Simple in-memory rate limiter (per client IP). Enough for one server; use a shared store if you ever run several.
const hits = new Map();
const limited = (key, max, windowMs) => {
  const t = Date.now(); const arr = (hits.get(key) || []).filter((x) => t - x < windowMs); arr.push(t); hits.set(key, arr);
  return arr.length > max;
};
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

route('POST', '/auth/request-otp', false, async ({ body, ip, req }) => {
  must(!limited('otp:' + ip, 20, 3600e3), 429, 'Too many requests. Please try again later.');
  const phone = normPhone(body.phone); must(phone, 400, 'Enter a valid Kenyan phone number.');
  const last = pq1('SELECT expires FROM otps WHERE phone=?', phone);
  must(!last || last.expires - 9 * 60 * 1000 < Date.now(), 429, 'Please wait a minute before asking for another code.');
  const code = String(crypto.randomInt(100000, 1000000));
  prun('INSERT INTO otps VALUES(?,?,?,0) ON CONFLICT(phone) DO UPDATE SET hash=?,expires=?,tries=0', phone, hash(phone + code), Date.now() + 10 * 60 * 1000, hash(phone + code), Date.now() + 10 * 60 * 1000);
  try { await sendSms(phone, otpSms(reqLang(req), code)); }
  catch (e) { prun('DELETE FROM otps WHERE phone=?', phone); console.error('SMS failed:', e.message); throw new HttpError(502, 'We could not send the SMS code. Please try again in a few minutes.'); }
  return { sent: true, ...(DEV && (process.env.SMS_PROVIDER || 'console') === 'console' ? { devCode: code } : {}) };
});

// Checks the SMS code (without using it up). Shared by member sign-in, developer sign-in and "move church".
function checkOtp(phone, code, ip) {
  must(!limited('verify:' + ip, 60, 3600e3), 429, 'Too many attempts. Please try again later.');
  const o = pq1('SELECT * FROM otps WHERE phone=?', phone);
  must(o && o.expires > Date.now(), 400, 'Code expired. Ask for a new one.');
  must(o.tries < 5, 429, 'Too many wrong attempts. Ask for a new code.');
  if (o.hash !== hash(phone + String(code))) { prun('UPDATE otps SET tries=tries+1 WHERE phone=?', phone); throw new HttpError(400, 'Wrong code.'); }
}
const useOtp = (phone) => prun('UPDATE otps SET expires=0 WHERE phone=?', phone);
const memberToken = (c, u) => sign({ uid: u.id, ch: c.id, exp: Date.now() + 30 * 24 * 3600 * 1000 });
const churchPublic = (c, withNumber) => ({ id: c.id, name: c.name, ...(withNumber ? { number: fmtNumber(c.number) } : {}), district: c.district || '', station: c.station || '', conference: c.conference || '', county: c.county || '', status: c.status });

// Creates the person in a church (or brings back their earlier archived row if they once belonged to it) and binds their phone to that church.
// Must run inside inChurch(). A leader role asked for here is only a request until someone at the church approves it.
function joinChurch(c, phone, p, { moving = false, previousRoles = [] } = {}) {
  const isAdmin = !!c.admin_phone && c.admin_phone === phone;
  const boot = defaultChurch && c.id === defaultChurch.id ? BOOTSTRAP[phone] : null;
  const wanted = LEADER_ROLES.includes(p.role) ? p.role : null;
  const former = [...new Set([...(Array.isArray(p.formerRoles) ? p.formerRoles : []), ...previousRoles])];
  const asked = wanted || (former.length ? 'former_leader' : 'member');
  let role = 'member', status = 'approved', requested = asked;
  if (isAdmin) { role = 'church_admin'; requested = 'church_admin'; }
  else if (boot && LEADER_ROLES.includes(boot)) { role = boot; requested = boot; }
  else if (wanted) { status = 'pending'; }
  else role = asked;
  const settings = P.settingsOf(c);
  const single = defaultChurch && c.id === defaultChurch.id; // a single-church install has no church number step, so nobody needs to be let in
  const join = isAdmin || boot || single || !settings.requireJoinApproval ? 'approved' : 'pending';
  const existing = q1('SELECT * FROM users WHERE phone=?', phone);
  const f = { name: String(p.name).trim(), idNumber: String(p.idNumber || '').trim(), mem: moving ? null : p.membershipNumber || null };
  let id;
  if (existing) { // coming back to a church they were archived from
    id = existing.id;
    run('UPDATE users SET name=?,id_number=?,membership_number=?,requested_role=?,role=?,role_status=?,former_roles=?,groups=?,church=?,district=?,station=?,conference=?,county=?,archived=0,join_status=? WHERE id=?',
      f.name, f.idNumber || existing.id_number, f.mem, requested, role, status, JSON.stringify(former), JSON.stringify(p.groups || []), c.name, c.district || '', c.station || '', c.conference || '', c.county || '', join, id);
    log(id, 'unarchive', 'users', id, 'rejoined');
  } else {
    id = uid();
    run('INSERT INTO users(id,phone,name,id_number,membership_number,requested_role,role,role_status,former_roles,groups,church,district,station,conference,county,created_at,join_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, phone, f.name, f.idNumber, f.mem, requested, role, status, JSON.stringify(former), JSON.stringify(p.groups || []), c.name, c.district || '', c.station || '', c.conference || '', c.county || '', now(), join);
    log(id, 'create', 'users', id, (moving ? 'moved in; ' : 'joined; ') + (status === 'pending' ? 'requested ' + asked : role));
  }
  prun('INSERT INTO bindings VALUES(?,?,?,?,?,?,NULL,NULL)', uid(), phone, c.id, id, 'active', now());
  plog(id, 'binding.create', c.id, phone + (moving ? ' (moved)' : ''));
  return q1('SELECT * FROM users WHERE id=?', id);
}

route('POST', '/auth/verify', false, ({ body, ip }) => {
  const phone = normPhone(body.phone); must(phone, 400, 'Invalid phone number.');
  checkOtp(phone, body.code, ip);
  const b = pq1("SELECT * FROM bindings WHERE phone=? AND status='active'", phone);
  if (b) { // returning member: the phone is already bound to exactly one church
    const c = churchOf(b.church_id);
    must(c && c.status === 'active', 403, c && c.status === 'suspended' ? 'This church account is paused. Please contact the church administrator.' : 'This church is not active.');
    return inChurch(c, () => {
      const u = q1('SELECT * FROM users WHERE id=?', b.user_id); must(u && !u.archived, 403, 'This account is archived. Contact the Church Secretary or Church Admin.');
      useOtp(phone);
      return { token: memberToken(c, u), user: publicUser(u), church: churchPublic(c) };
    });
  }
  // A new person: they say which church by typing the church number the app developer gave their church.
  let c = null;
  if (body.churchNumber) { c = churchByNumber(body.churchNumber); must(c && c.status === 'active', 404, 'That church number was not found. Check it with your church secretary.'); }
  else if (defaultChurch) c = churchOf(defaultChurch.id);
  must(c, 400, 'Enter your church number. Your church administrator can tell you what it is.');
  must(body.profile && body.profile.name && body.profile.idNumber, 400, 'New account: send profile with name and idNumber.');
  return inChurch(c, () => {
    useOtp(phone);
    const u = joinChurch(c, phone, body.profile);
    return { token: memberToken(c, u), user: publicUser(u), church: churchPublic(c) };
  });
});

// Is this phone already bound? (Lets the sign-in screen know whether to ask for a church number.)
route('POST', '/auth/lookup', false, ({ body, ip }) => {
  must(!limited('lookup:' + ip, 60, 3600e3), 429, 'Too many requests. Please try again later.');
  const phone = normPhone(body.phone); must(phone, 400, 'Invalid phone number.');
  const out_ = { bound: !!pq1("SELECT 1 FROM bindings WHERE phone=? AND status='active'", phone) };
  if (body.churchNumber) { const c = churchByNumber(body.churchNumber); out_.church = c && c.status === 'active' ? { name: c.name } : null; }
  return out_;
});

// Move to another church: the person proves it is them again (fresh SMS code) and types the new church's number.
// The old membership is archived (the old church keeps its history), the phone is bound to the new church, and from then on
// everything the person does belongs to the new church only. A leader position has to be verified again at the new church.
route('POST', '/me/move', true, ({ me, body, ip }) => {
  const to = churchByNumber(body.churchNumber); must(to && to.status === 'active', 404, 'That church number was not found.');
  const from = ctx().church; must(to.id !== from.id, 409, 'You already belong to this church.');
  checkOtp(me.phone, body.code, ip);
  const prof = { name: me.name, idNumber: me.id_number, groups: Array.isArray(body.groups) ? body.groups : [], role: body.role, formerRoles: [] };
  const prevRoles = me.role_status === 'approved' && LEADER_ROLES.includes(me.role) ? [me.role] : JSON.parse(me.former_roles);
  const a = actor(me); must(a.eff !== 'church_admin', 409, 'A Church Admin must ask the app developer to appoint a new admin before moving.');
  // leave the old church
  run('UPDATE users SET archived=1 WHERE id=?', me.id); log(me.id, 'archive', 'users', me.id, 'moved to another church');
  prun("UPDATE bindings SET status='archived', until=?, reason=? WHERE phone=? AND status='active'", now(), 'moved to ' + to.name, me.phone);
  plog(me.id, 'binding.archive', from.id, me.phone + ' moved to ' + to.id);
  let user;
  try { user = inChurch(to, () => joinChurch(to, me.phone, prof, { moving: true, previousRoles: prevRoles })); }
  catch (e) { // nothing is lost if joining the new church fails: put the person back where they were
    run('UPDATE users SET archived=0 WHERE id=?', me.id); prun("UPDATE bindings SET status='active', until=NULL, reason=NULL WHERE phone=? AND church_id=? AND user_id=?", me.phone, from.id, me.id); throw e;
  }
  useOtp(me.phone);
  return { token: memberToken(to, user), user: publicUser(user), church: churchPublic(to) };
}, { pendingOk: true });

// The first-run guide is shown once per role. The app sends the role whose guide the person has just seen (or skipped).
route('POST', '/me/guide-seen', true, ({ me, body }) => {
  must(typeof body.role === 'string' && /^[a-z_0-9]{1,40}$/.test(body.role), 400, 'Bad payload.');
  run('UPDATE users SET guide_seen=? WHERE id=?', body.role, me.id); return { guideSeen: body.role };
}, { pendingOk: true });
route('POST', '/me/lang', true, ({ me, body }) => { must(['en', 'sw'].includes(body.lang), 400, 'Bad payload.'); run('UPDATE users SET lang=? WHERE id=?', body.lang, me.id); return { lang: body.lang }; }, { pendingOk: true });
// A phone registers itself to get push notifications. Switching off keeps the row (archive-only) but stops sending.
route('POST', '/me/push-token', true, ({ me, body, ip }) => {
  must(!limited('push:' + me.id, 30, 3600e3), 429, 'Too many requests. Please try again later.');
  must(validPushToken(body.token), 400, 'Bad payload.'); const t = now();
  run("INSERT INTO push_tokens(token,user_id,platform,active,created_at,updated_at) VALUES(?,?,?,1,?,?) ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, platform=excluded.platform, active=1, updated_at=excluded.updated_at", body.token, me.id, ['android', 'ios'].includes(body.platform) ? body.platform : null, t, t);
  return { registered: true };
}, { pendingOk: true });
route('POST', '/me/push-token/off', true, ({ me, body }) => { must(typeof body.token === 'string', 400, 'Bad payload.'); run('UPDATE push_tokens SET active=0, updated_at=? WHERE token=? AND user_id=?', now(), body.token, me.id); return { registered: false }; }, { pendingOk: true });
route('GET', '/me', true, ({ me }) => ({ user: publicUser(me), joinStatus: me.join_status, church: churchPublic(ctx().church, actor(me).eff === 'church_admin'), settings: P.settingsOf(ctx().church), ...(actor(me).eff === 'church_admin' ? { supportUnread: supportUnread(ctx().church.id, 'admin') } : {}) }), { pendingOk: true });

// People list – scoped by role. People waiting to be approved to join are only listed for the people who approve them.
route('GET', '/users', true, ({ me }) => {
  const a = actor(me);
  const sees = isIn(a, 'secretary', 'clerk', 'pastor', 'church_admin');
  let rows = q("SELECT * FROM users WHERE archived=0 AND (join_status='approved' OR ?) ORDER BY name", isIn(a, 'church_admin', 'secretary', 'pastor') ? 1 : 0);
  if (!sees) {
    const g = led(a);
    rows = rows.filter((u) => u.id === a.id || (g && JSON.parse(u.groups).includes(g)));
  }
  return { users: rows.map(publicUser) };
});
const canDecideRoles = (a) => isIn(a, 'secretary', 'pastor', 'church_admin');
route('GET', '/users/pending-roles', true, ({ me }) => {
  must(canDecideRoles(actor(me)), 403, 'Only the Secretary, Pastor or Church Admin verifies leader roles.');
  return { users: q("SELECT * FROM users WHERE role_status='pending' AND join_status='approved' AND archived=0").map(publicUser) };
});
route('POST', '/users/:id/role-decision', true, ({ me, params, body }) => {
  const a = actor(me); must(canDecideRoles(a), 403, 'Only the Secretary, Pastor or Church Admin verifies leader roles.');
  const u = q1('SELECT * FROM users WHERE id=?', params.id); must(u, 404, 'No such user.');
  must(u.id !== me.id, 403, 'You cannot approve your own role.');
  if (body.approve) { run("UPDATE users SET role=requested_role, role_status='approved' WHERE id=?", u.id); log(me.id, 'update', 'users', u.id, 'role approved: ' + u.requested_role); }
  else { run("UPDATE users SET role_status='declined' WHERE id=?", u.id); log(me.id, 'update', 'users', u.id, 'role declined'); }
  sendSms(u.phone, roleSms(u.lang, !!body.approve, roleName(u.requested_role, u.lang))).catch((e) => console.error('Role SMS failed:', e.message));
  notifyUsers([u.id], 'role', { ok: !!body.approve }, { screen: 'home' });
  return { user: publicUser(q1('SELECT * FROM users WHERE id=?', u.id)) };
});
// Archiving a person frees their phone, so they can join (or be added by) another church. Nothing they did is removed.
function archiveUser(by, id, reason) {
  const u = q1('SELECT * FROM users WHERE id=?', id); must(u, 404, 'No such user.');
  run('UPDATE users SET archived=1 WHERE id=?', id); log(by.id, 'archive', 'users', id, reason || '');
  prun("UPDATE bindings SET status='archived', until=?, reason=? WHERE user_id=? AND church_id=? AND status='active'", now(), reason || 'archived by the church', id, ctx().church.id);
  plog(by.id, 'binding.archive', ctx().church.id, u.phone);
}
route('POST', '/users/:id/archive', true, ({ me, params, body }) => {
  must(isIn(actor(me), 'secretary', 'pastor'), 403, 'Only the Secretary or Pastor can archive an account.');
  must(params.id !== me.id, 403, 'You cannot archive your own account.');
  archiveUser(me, params.id, body.reason); return { archived: true };
});

// Generic collections
route('GET', '/records/:col', true, ({ me, params, query }) => {
  must(COLLECTIONS.includes(params.col), 404, 'Unknown collection.');
  const a = actor(me); const includeArchived = query.get('archived') === '1';
  const rows = q('SELECT * FROM records WHERE col=? ORDER BY created_at', params.col);
  const res = [];
  for (const r of rows) {
    const d = JSON.parse(r.data);
    if (!policy.read(params.col, a, r, d)) continue;
    if (r.archived && !(includeArchived && (policy.archive(params.col, a, r, d) || policy.restore(a, params.col)))) continue;
    res.push(out(r));
  }
  return { records: res };
});

route('POST', '/records/:col', true, ({ me, params, body, req }) => {
  const col = params.col; must(COLLECTIONS.includes(col), 404, 'Unknown collection.');
  // Offline outbox: the phone sends a one-off key with each queued item. A retry of the same key returns the first record instead of adding it again.
  const idemKey = String(req.headers['x-idempotency-key'] || ''); const idem = /^[A-Za-z0-9_-]{16,64}$/.test(idemKey) ? idemKey : '';
  if (idem) { const seen = q1('SELECT record_id FROM idempotency WHERE key=? AND user_id=? AND col=?', idem, me.id, col); if (seen) { const rec = getRec(col, seen.record_id); if (rec) return { record: out(rec), replayed: true }; } }
  const a = actor(me); const d = { ...body };
  for (const k of ['id', 'createdBy', 'createdAt', 'archived', 'archivedAt', 'archivedBy', 'archiveReason']) delete d[k];
  must(policy.create(col, a, d), 403, 'You are not allowed to add this.');
  if (col === 'notices') {
    must(d.title && d.body, 400, 'Title and message are required.');
    d.authorName = me.name; d.authorRole = a.eff;
    d.status = d.board === 'group' && led(a) !== d.groupKey ? 'pending' : 'published'; // group leader posts freely; everyone else needs approval
    delete d.approvedBy; delete d.approvedAt;
  }
  if (col === 'payments') {
    const code = String(d.mpesaCode || '').trim().toUpperCase();
    must(/^[A-Z0-9]{10}$/.test(code), 400, 'The M-Pesa code must be 10 letters/digits.');
    must(!q1("SELECT 1 FROM records WHERE col='payments' AND json_extract(data,'$.mpesaCode')=?", code), 409, 'That M-Pesa code was already submitted.');
    must(String(d.purpose || '').trim(), 400, 'Please state the purpose of payment.');
    const s = calculateSplit(Number(d.amount), d.allocations || d.split); must(!s.error, 400, s.error);
    // Build the record from scratch so nothing else the phone sends (for example a fake "verified" mark) is kept.
    const clean = { memberId: me.id, memberName: me.name, mpesaCode: code, mpesaName: String(d.mpesaName || me.name).slice(0, 100), purpose: String(d.purpose).trim().slice(0, 300), amount: Number(d.amount), allocations: s.allocations, status: 'pending' };
    for (const k of Object.keys(d)) delete d[k];
    Object.assign(d, clean);
  }
  if (col === 'office') { const c = cleanOffice(d); for (const k of Object.keys(d)) delete d[k]; Object.assign(d, c); }
  if (col === 'campreg') { const c = cleanCamp(d, me, CAMP.includes(a.eff)); for (const k of Object.keys(d)) delete d[k]; Object.assign(d, c); }
  if (col === 'memberships') {
    // Baptism is recorded straight into the list; transfers always start as an application for the Church Board.
    d.status = d.entry === 'baptism' ? 'active' : 'application';
    delete d.boardDecision; delete d.memberNumber; delete d.applicantId; // applicantId is only ever set by /membership/apply
    if (d.status === 'active') d.memberNumber = 'M-' + String(nextNo('member')).padStart(4, '0');
  }
  const id = insertRec(col, d, me.id);
  if (idem) run('INSERT OR IGNORE INTO idempotency(key,user_id,col,record_id,at) VALUES(?,?,?,?,?)', idem, me.id, col, id, now());
  if (col === 'notices') { if (d.status === 'published') notifyNotice(id, d, me.id); else notifyUsers(usersWhere((a) => led(a) === d.groupKey).map((u) => u.id), 'approval', { title: d.title }, { screen: 'group' }); }
  if (col === 'payments') notifyRole('treasurer', 'payment', { name: me.name, amount: d.amount }, { screen: 'payments' });
  if (col === 'payments' && mpesaOn()) { try { verifyPayment(getRec('payments', id)); } catch (e) { console.error('M-Pesa check failed:', e.message); } }
  return { record: out(getRec(col, id)) };
});

route('POST', '/records/:col/:id/archive', true, ({ me, params, body }) => {
  const r = getRec(params.col, params.id); must(r, 404, 'Not found.');
  const d = JSON.parse(r.data); must(policy.archive(params.col, actor(me), r, d), 403, 'You are not allowed to archive this.');
  run('UPDATE records SET archived=1,archived_at=?,archived_by=?,archive_reason=? WHERE id=?', now(), me.name, body.reason || '', r.id);
  log(me.id, 'archive', params.col, r.id, body.reason || ''); return { archived: true };
});
route('POST', '/records/:col/:id/restore', true, ({ me, params }) => {
  const r = getRec(params.col, params.id); must(r, 404, 'Not found.');
  must(policy.restore(actor(me), params.col), 403, 'You are not allowed to restore this.');
  run('UPDATE records SET archived=0,archived_at=NULL,archived_by=NULL,archive_reason=NULL WHERE id=?', r.id);
  log(me.id, 'unarchive', params.col, r.id); return { archived: false };
});


// Camp officers set the fee, record payments and check people in. Nothing is overwritten: payments are added to a history.
route('POST', '/camp/registrations/:id/action', true, ({ me, params, body }) => {
  must(CAMP.includes(actor(me).eff), 403, 'Only the camp meeting officers can do this.');
  const r = getRec('campreg', params.id); must(r && !r.archived, 404, 'Not found.'); const d = JSON.parse(r.data);
  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (body.action === 'fee') { must(amount >= 0 && amount <= 1e7, 400, 'Enter the fee.'); setData(r.id, { ...d, fee: amount }, me.id, 'fee set ' + amount); }
  else if (body.action === 'payment') { must(amount > 0 && amount <= 1e7, 400, 'Enter the amount paid.'); const payments = [...d.payments, { amount, at: now(), by: me.name }]; setData(r.id, { ...d, payments, paid: Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100 }, me.id, 'payment ' + amount); }
  else if (body.action === 'checkin' || body.action === 'uncheck') { setData(r.id, { ...d, checkedIn: body.action === 'checkin', checkedInAt: body.action === 'checkin' ? now() : null }, me.id, body.action); }
  else must(false, 400, 'Bad payload.');
  return { record: out(getRec('campreg', r.id)) };
});

// Treasurer confirms a payment -> receipt is issued to the member immediately.
// Issues the receipt for a pending payment. `by` is the Treasurer ({id,name,church}); null means automatic confirmation against M-Pesa.
function issueReceipt(r, p, by) {
  const member = q1('SELECT phone, church, lang FROM users WHERE id=?', p.memberId);
  const church = churchName();
  const actorId = by ? by.id : 'system', byName = by ? by.name : 'M-Pesa (automatic)';
  db.exec('BEGIN');
  try {
    const at = now(); const receiptNo = 'RCT-' + String(nextNo('receipt')).padStart(5, '0');
    const text = receiptTextL(member ? member.lang : 'en', p, receiptNo, church, by ? by.name : null, at);
    const rid = insertRec('receipts', { receiptNo, paymentId: r.id, memberId: p.memberId, memberName: p.memberName, mpesaCode: p.mpesaCode, amount: p.amount, allocations: p.allocations, issuedBy: byName, issuedAt: at, text }, actorId);
    setData(r.id, { ...p, status: 'received', receivedBy: byName, receivedAt: at, receiptNo }, actorId, 'received ' + receiptNo);
    for (const al of p.allocations) {
      if (al.category === 'Church Building') insertRec('projects', { project: 'Church Building', kind: 'contribution', title: 'Contribution – ' + p.memberName, amount: al.amount, note: 'From ' + p.mpesaCode }, actorId);
      if (al.category === 'Welfare / Benevolent') insertRec('welfare', { fund: 'Burial and Benevolent Fund', kind: 'contribution', title: 'Contribution – ' + p.memberName, amount: al.amount, note: 'From ' + p.mpesaCode }, actorId);
    }
    db.exec('COMMIT');
    // Text the receipt to the member too. This never blocks or fails the confirmation: the receipt is already saved in the app.
    if (process.env.SMS_RECEIPTS !== '0' && member) {
      const parts = p.allocations.map((al) => `${al.category} ${ksh(al.amount)}`).join(', ');
      sendSms(member.phone, receiptSms(member.lang, { receiptNo, church, amount: p.amount, memberName: p.memberName, mpesaCode: p.mpesaCode, parts })).catch((e) => console.error('Receipt SMS failed:', e.message));
    }
    notifyUsers([p.memberId], 'receipt', { receiptNo, church, amount: p.amount }, { screen: 'receipts' });
    return out(getRec('receipts', rid));
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

route('POST', '/payments/:id/receive', true, ({ me, params, body }) => {
  must(actor(me).eff === 'treasurer', 403, 'Only the Church Treasurer can confirm payments.');
  const r = getRec('payments', params.id); must(r && !r.archived, 404, 'Payment not found.');
  const p = JSON.parse(r.data); must(p.status === 'pending', 409, 'This payment was already received.');
  const v = p.verification;
  const unverified = mpesaOn() && !(v && v.state === 'verified');
  if (unverified && body.confirmAnyway !== true) {
    throw new HttpError(412, v && v.state === 'amount_mismatch'
      ? `M-Pesa shows ${ksh(v.mpesaAmount)} for this code, but the member said ${ksh(p.amount)}. Confirm only if you have checked.`
      : 'This code has not appeared on the Pay Bill yet. Wait a few minutes, or confirm only if you have checked the M-Pesa statement.');
  }
  const receipt = issueReceipt(r, p, { id: me.id, name: me.name, church: me.church });
  if (unverified) log(me.id, 'update', 'payments', r.id, 'confirmed without a matching M-Pesa record' + (v ? ' (' + v.state + ')' : ''));
  return { receipt };
});

// ---------------------------------------------------------------- M-Pesa Pay Bill confirmation (Safaricom Daraja "C2B")
// Safaricom tells this server about every payment to the church Pay Bill. When a member reports an M-Pesa code, the server
// checks that the payment really exists and that the amount matches, and shows the Treasurer a "verified" mark.
// With MPESA_AUTO_RECEIPT=1 a verified payment is receipted automatically; otherwise the Treasurer still taps Received.
// The phone number in these messages is masked by Safaricom, so payments are matched on the M-Pesa code, not on the phone.
const mpesaSecret = () => process.env.MPESA_CALLBACK_SECRET || '';
const mpesaOn = () => mpesaSecret().length >= 32;
const mpesaName = (t) => [t.first_name, t.middle_name, t.last_name].filter(Boolean).join(' ');
const mpesaTime = (t) => (/^\d{14}$/.test(t || '') ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}+03:00` : null); // Kenyan time

function verifyPayment(r) {
  const p = JSON.parse(r.data); if (p.status !== 'pending') return;
  const tx = q1('SELECT * FROM mpesa_tx WHERE trans_id=?', p.mpesaCode);
  const v = tx
    ? { state: Math.abs(tx.amount - p.amount) < 0.005 ? 'verified' : 'amount_mismatch', mpesaAmount: tx.amount, mpesaName: mpesaName(tx), mpesaTime: mpesaTime(tx.trans_time), checkedAt: now() }
    : { state: 'waiting', checkedAt: now() };
  if (tx && !tx.payment_id) run('UPDATE mpesa_tx SET payment_id=? WHERE trans_id=?', r.id, tx.trans_id);
  if (!p.verification || p.verification.state !== v.state || p.verification.mpesaAmount !== v.mpesaAmount) {
    setData(r.id, { ...p, verification: v }, 'system', 'M-Pesa check: ' + v.state);
    if (v.state === 'verified' && process.env.MPESA_AUTO_RECEIPT === '1') issueReceipt(getRec('payments', r.id), { ...p, verification: v }, null);
  }
}

const hookAuth = (secret) => {
  const e = mpesaSecret();
  must(mpesaOn() && secret.length === e.length && crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(e)), 404, 'Not found.'); // wrong secret looks like a missing page
};
const ACCEPTED = { ResultCode: '0', ResultDesc: 'Accepted' };

// Safaricom calls these two addresses (set up with mpesa-register.mjs). The secret in the address is the only credential, so keep it private.
route('POST', '/hooks/c2b/:secret/validation', false, ({ params, ip }) => { must(!limited('hook:' + ip, 3000, 3600e3), 429, 'Slow down.'); hookAuth(params.secret); return ACCEPTED; });
route('POST', '/hooks/c2b/:secret/confirmation', false, ({ params, body, ip }) => {
  must(!limited('hook:' + ip, 3000, 3600e3), 429, 'Slow down.'); hookAuth(params.secret);
  const id = String(body.TransID || '').trim().toUpperCase(); const amount = Number(body.TransAmount);
  must(/^[A-Z0-9]{8,12}$/.test(id) && Number.isFinite(amount) && amount > 0, 400, 'Bad payload.');
  const sc = process.env.MPESA_SHORTCODE;
  if (sc && String(body.BusinessShortCode) !== sc) { console.warn('M-Pesa: ignoring a payment for another shortcode', body.BusinessShortCode); return ACCEPTED; }
  // Which church does this payment belong to? The one whose Pay Bill (set by its admin) is this shortcode; otherwise the default church.
  const code = String(body.BusinessShortCode || '');
  const target = pq("SELECT * FROM churches WHERE status='active'").find((c) => code && P.settingsOf(c).paybill === code) || (defaultChurch && churchOf(defaultChurch.id));
  if (!target) { console.warn('M-Pesa: no church has Pay Bill', code); return ACCEPTED; }
  inChurch(target, () => {
  const ins = run('INSERT OR IGNORE INTO mpesa_tx(trans_id,amount,bill_ref,msisdn,first_name,middle_name,last_name,trans_time,shortcode,raw,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, amount, String(body.BillRefNumber || '').slice(0, 100), String(body.MSISDN || '').slice(0, 40), String(body.FirstName || '').slice(0, 60), String(body.MiddleName || '').slice(0, 60), String(body.LastName || '').slice(0, 60),
    String(body.TransTime || '').slice(0, 14), String(body.BusinessShortCode || '').slice(0, 10), JSON.stringify(body).slice(0, 4000), now());
  if (ins.changes) {
    log('system', 'create', 'mpesa_tx', id, ksh(amount));
    try { const pay = q1("SELECT * FROM records WHERE col='payments' AND archived=0 AND json_extract(data,'$.mpesaCode')=?", id); if (pay) verifyPayment(pay); }
    catch (e) { console.error('M-Pesa matching failed:', e.message); } // the payment itself is already stored; Safaricom must always get its answer
  }
  });
  return ACCEPTED; // also for repeats: Safaricom may send the same payment twice
});

// Money that arrived on the Pay Bill but that no member has reported yet.
route('GET', '/finance/unclaimed', true, ({ me }) => {
  must(isIn(actor(me), 'treasurer', 'pastor'), 403, 'Only the Treasurer or Pastor can see this.');
  const rows = q('SELECT trans_id, amount, bill_ref, first_name, middle_name, last_name, trans_time, received_at FROM mpesa_tx WHERE payment_id IS NULL ORDER BY received_at DESC LIMIT 100');
  return { enabled: mpesaOn(), transactions: rows.map((t) => ({ code: t.trans_id, amount: t.amount, reference: t.bill_ref, name: mpesaName(t), paidAt: mpesaTime(t.trans_time), receivedAt: t.received_at })) };
});

// ---------------------------------------------------------------- statements and reports (read-only; they never change records)
const KE_OFFSET = 3 * 3600e3; // Kenya time is UTC+3 all year
const keDate = (iso) => new Date(Date.parse(iso) + KE_OFFSET).toISOString().slice(0, 10);
const csvCell = (v) => {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t) && typeof v !== 'number') t = "'" + t; // stops spreadsheet formulas typed into names from running
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
const csvLine = (cells) => cells.map(csvCell).join(',');
const sumBy = (items) => { const m = {}; for (const it of items) for (const a of it.allocations || []) m[a.category] = round2((m[a.category] || 0) + a.amount); return m; };
const receiptsOf = () => q("SELECT * FROM records WHERE col='receipts' ORDER BY created_at").map((r) => ({ ...JSON.parse(r.data), id: r.id, date: keDate(JSON.parse(r.data).issuedAt || r.created_at) }));

// A member's giving statement for a year (receipted payments only). Members see their own; the Treasurer and Pastor can look up anyone.
route('GET', '/statements/:year', true, ({ me, params, query }) => {
  const a = actor(me); const year = Number(params.year);
  must(Number.isInteger(year) && year >= 2000 && year <= 2100, 400, 'Choose a valid year.');
  const mid = query.get('memberId') || me.id;
  must(mid === me.id || isIn(a, 'treasurer', 'pastor'), 403, 'You can only see your own statement.');
  const m = q1('SELECT * FROM users WHERE id=?', mid); must(m, 404, 'Member not found.');
  const items = receiptsOf().filter((r) => r.memberId === mid && r.date.startsWith(String(year))).map((r) => ({ date: r.date, receiptNo: r.receiptNo, mpesaCode: r.mpesaCode, amount: r.amount, allocations: r.allocations }));
  const byCategory = sumBy(items); const total = round2(items.reduce((s, i) => s + i.amount, 0));
  const church = churchName();
  const sw = query.get('lang') === 'sw'; // Kiswahili statement text (member names and amounts are unchanged)
  const L = sw
    ? { title: 'TAARIFA YA UTOAJI', member: 'Mshiriki', no: 'Nambari ya uanachama', period: `Kipindi: 1 Januari ${year} hadi 31 Desemba ${year}`, none: 'Hakuna utoaji uliotolewa risiti katika mwaka huu.', by: 'Jumla kwa madhumuni:', total: 'JUMLA ILIYOTOLEWA', note: 'Taarifa hii inaorodhesha malipo ambayo Mweka Hazina wa Kanisa ameyatolea risiti pekee. Asante kwa uaminifu wako. Mungu akubariki.' }
    : { title: 'GIVING STATEMENT', member: 'Member', no: 'Membership no', period: `Period: 1 January ${year} to 31 December ${year}`, none: 'No receipted giving in this year.', by: 'Totals by purpose:', total: 'TOTAL GIVEN', note: 'This statement lists only payments the Church Treasurer has receipted. Thank you for your faithfulness. God bless you.' };
  const catSw = { Tithe: 'Zaka', Offering: 'Sadaka', '13th Sabbath': 'Sabato ya 13', 'Church Budget': 'Bajeti ya Kanisa', 'Field Advance': 'Maendeleo ya Konferensi', 'Camp Meeting': 'Mkutano wa Kambi', 'Church Building': 'Ujenzi wa Kanisa', 'Welfare / Benevolent': 'Ustawi / Hisani', Other: 'Nyingine' };
  const cn = (c) => (sw && catSw[c]) || c;
  const text = [`${L.title} ${year}`, church, '', `${L.member}: ${m.name}${m.membership_number ? `   ${L.no}: ${m.membership_number}` : ''}`, L.period, '',
    ...(items.length ? items.map((i) => `${i.date}  ${i.receiptNo}  ${ksh(i.amount)}\n    ${i.allocations.map((al) => `${cn(al.category)} ${ksh(al.amount)}`).join(', ')}`) : [L.none]),
    '', L.by, ...Object.entries(byCategory).map(([k, v]) => `  ${cn(k)}: ${ksh(v)}`), `${L.total}: ${ksh(total)}`, '', L.note].join('\n');
  return { year, church, member: { id: m.id, name: m.name, membershipNumber: m.membership_number || '' }, items, byCategory, total, text };
});

// The Treasurer's monthly report as spreadsheet text (CSV): one row per receipted payment, a column per purpose, and totals.
route('GET', '/reports/monthly/:month', true, ({ me, params }) => {
  must(isIn(actor(me), 'treasurer', 'pastor'), 403, 'Only the Treasurer or Pastor can see this report.');
  must(/^\d{4}-(0[1-9]|1[0-2])$/.test(params.month), 400, 'Choose a month like 2026-10.');
  const rows = receiptsOf().filter((r) => r.date.startsWith(params.month)).sort((x, y) => (x.issuedAt < y.issuedAt ? -1 : 1));
  const cats = [...new Set(rows.flatMap((r) => (r.allocations || []).map((al) => al.category)))].sort();
  const byCategory = sumBy(rows); const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  const lines = [csvLine(['Date', 'Receipt no', 'Member', 'M-Pesa code', 'Total (KSh)', ...cats, 'Receipted by'])];
  for (const r of rows) lines.push(csvLine([r.date, r.receiptNo, r.memberName, r.mpesaCode, r.amount, ...cats.map((c) => (r.allocations.find((al) => al.category === c) || {}).amount || 0), r.issuedBy]));
  lines.push(csvLine(['TOTAL', '', '', '', total, ...cats.map((c) => byCategory[c] || 0), '']));
  const pending = q("SELECT data FROM records WHERE col='payments' AND archived=0").filter((x) => JSON.parse(x.data).status === 'pending').length;
  return { month: params.month, count: rows.length, total, byCategory, pendingNotReceipted: pending, csv: '﻿' + lines.join('\r\n') + '\r\n' };
});

// ---------------------------------------------------------------- yearly church report for the Pastor and the Church Board (totals only: no individual's giving)
const BOARD_ROLES = ['pastor', 'treasurer', 'secretary', 'clerk', 'elder1', 'elder2', 'elder3', 'elder4'];
const RPT = {
  en: { title: 'Annual Church Report', giving: 'Giving (receipted)', total: 'Total received', receipts: 'Receipts issued', byCat: 'By purpose', byMonth: 'By month', members: 'Membership', active: 'Members on the roll at year end', bapt: 'Baptisms in the year', trIn: 'Transfers received', trWait: 'Transfer applications still waiting', joined: 'New app sign-ups', ss: 'Sabbath School', weeks: 'Sabbaths recorded', avg: 'Average present', visitors: 'Visitors in total', welfare: 'Welfare funds', fund: 'Fund', contrib: 'Contributions', building: 'Church Building', income: 'Contributions', spent: 'Spent', pledged: 'Pledged', paid: 'Paid on pledges', balance: 'Pledge balance', camp: 'Camp meeting', regs: 'Registrations', fees: 'Fees set', feesPaid: 'Fees paid', other: 'Church life', acts: 'Activities planned', mins: 'Minutes kept', serm: 'Sermon summaries', year: 'Year', church: 'Church', gen: 'Prepared', note: 'Totals only. No individual member\'s giving is shown in this report.' },
  sw: { title: 'Ripoti ya Mwaka ya Kanisa', giving: 'Utoaji (uliotolewa risiti)', total: 'Jumla iliyopokelewa', receipts: 'Risiti zilizotolewa', byCat: 'Kwa madhumuni', byMonth: 'Kwa mwezi', members: 'Uanachama', active: 'Wanachama kwenye orodha mwisho wa mwaka', bapt: 'Ubatizo katika mwaka', trIn: 'Uhamisho uliopokelewa', trWait: 'Maombi ya uhamisho yanayosubiri', joined: 'Waliojiunga na programu', ss: 'Shule ya Sabato', weeks: 'Sabato zilizorekodiwa', avg: 'Wastani wa waliohudhuria', visitors: 'Wageni kwa jumla', welfare: 'Mifuko ya ustawi', fund: 'Mfuko', contrib: 'Michango', building: 'Ujenzi wa Kanisa', income: 'Michango', spent: 'Iliyotumika', pledged: 'Ahadi', paid: 'Iliyolipwa kwa ahadi', balance: 'Salio la ahadi', camp: 'Mkutano wa kambi', regs: 'Waliosajiliwa', fees: 'Ada zilizowekwa', feesPaid: 'Ada zilizolipwa', other: 'Maisha ya kanisa', acts: 'Shughuli zilizopangwa', mins: 'Muhtasari wa vikao uliohifadhiwa', serm: 'Muhtasari wa mahubiri', year: 'Mwaka', church: 'Kanisa', gen: 'Imeandaliwa', note: 'Jumla tu. Utoaji wa mshiriki yeyote hauonyeshwi kwenye ripoti hii.' },
};
route('GET', '/reports/yearly/:year', true, ({ me, params, query }) => {
  must(isIn(actor(me), ...BOARD_ROLES), 403, 'Only the Pastor and the Church Board can see this report.');
  must(/^20\d\d$/.test(params.year), 400, 'Choose a valid year.');
  const Y = params.year; const L = RPT[query.get('lang') === 'sw' ? 'sw' : 'en'];
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const live = (col) => q('SELECT * FROM records WHERE col=? AND archived=0', col).map((r) => ({ ...JSON.parse(r.data), id: r.id, createdAt: r.created_at, day: keDate(r.created_at) }));
  const inYear = (d) => String(d || '').startsWith(Y);
  // giving
  const rc = receiptsOf().filter((r) => r.date.startsWith(Y));
  const byMonth = Array.from({ length: 12 }, (_, i) => round2(rc.filter((r) => r.date.slice(5, 7) === String(i + 1).padStart(2, '0')).reduce((t, r) => t + r.amount, 0)));
  const giving = { total: round2(rc.reduce((t, r) => t + r.amount, 0)), receipts: rc.length, byCategory: sumBy(rc), byMonth };
  // membership
  const ms = live('memberships'); const yearEnd = Y + '-12-31';
  const membership = {
    onRoll: ms.filter((m) => m.status === 'active' && (m.day || '') <= yearEnd).length,
    baptisms: ms.filter((m) => m.entry === 'baptism' && m.status === 'active' && inYear(m.baptismDate || m.date || m.day)).length,
    transfersIn: ms.filter((m) => m.entry === 'transfer' && m.status === 'active' && inYear(m.day)).length,
    transfersWaiting: ms.filter((m) => m.status === 'application').length,
    appSignups: q("SELECT COUNT(*) n FROM users WHERE join_status='approved' AND created_at LIKE ?", Y + '%').n,
  };
  // sabbath school
  const att = live('office').filter((o) => o.kind === 'attendance' && inYear(o.date));
  const presentOf = (o) => (o.classes || []).reduce((t, c) => t + num(c.present), 0);
  const sabbathSchool = { weeks: att.length, averagePresent: att.length ? Math.round(att.reduce((t, o) => t + presentOf(o), 0) / att.length) : 0, visitors: att.reduce((t, o) => t + num(o.visitors), 0) };
  // welfare, building, pledges
  const welfare = {}; for (const w of live('welfare').filter((x) => inYear(x.day) && x.kind !== 'case')) welfare[w.fund] = round2((welfare[w.fund] || 0) + num(w.amount));
  const pr = live('projects').filter((x) => inYear(x.day));
  const off = live('office');
  const pledges = off.filter((o) => o.office === 'building' && o.kind === 'pledge' && inYear(o.day));
  const pledgeIds = new Set(off.filter((o) => o.office === 'building' && o.kind === 'pledge').map((o) => o.id));
  const pledgePaid = off.filter((o) => o.kind === 'pledge_payment' && pledgeIds.has(o.pledgeId) && inYear(o.date || o.day));
  const building = { contributions: round2(pr.filter((x) => x.kind === 'contribution').reduce((t, x) => t + num(x.amount), 0)), spent: round2(pr.filter((x) => x.kind === 'expense').reduce((t, x) => t + num(x.amount), 0)),
    pledged: round2(pledges.reduce((t, x) => t + num(x.amount), 0)), pledgePaid: round2(pledgePaid.reduce((t, x) => t + num(x.amount), 0)) };
  building.pledgeBalance = round2(Math.max(0, building.pledged - building.pledgePaid));
  // camp
  const cr = live('campreg').filter((x) => inYear(x.day));
  const camp = { registrations: cr.length, fees: round2(cr.reduce((t, x) => t + num(x.fee), 0)), paid: round2(cr.reduce((t, x) => t + num(x.paid), 0)) };
  // church life
  const life = { activities: live('activities').filter((x) => inYear(x.date || x.day)).length, minutes: live('minutes').filter((x) => inYear(x.date || x.day)).length, sermons: live('sermons').filter((x) => inYear(x.day)).length };
  const church = ctx().church.name;
  const k = (n) => 'KSh ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const T = [`${L.title} ${Y}`, church, `${L.gen}: ${keDate(now())}`, '',
    L.giving, `  ${L.total}: ${k(giving.total)}`, `  ${L.receipts}: ${giving.receipts}`, ...(Object.keys(giving.byCategory).length ? [`  ${L.byCat}:`, ...Object.entries(giving.byCategory).map(([c, a]) => `    ${c}: ${k(a)}`)] : []), '',
    L.members, `  ${L.active}: ${membership.onRoll}`, `  ${L.bapt}: ${membership.baptisms}`, `  ${L.trIn}: ${membership.transfersIn}`, `  ${L.trWait}: ${membership.transfersWaiting}`, `  ${L.joined}: ${membership.appSignups}`, '',
    L.ss, `  ${L.weeks}: ${sabbathSchool.weeks}`, `  ${L.avg}: ${sabbathSchool.averagePresent}`, `  ${L.visitors}: ${sabbathSchool.visitors}`, '',
    L.welfare, ...(Object.keys(welfare).length ? Object.entries(welfare).map(([f, a]) => `  ${f}: ${k(a)}`) : ['  —']), '',
    L.building, `  ${L.income}: ${k(building.contributions)}`, `  ${L.spent}: ${k(building.spent)}`, `  ${L.pledged}: ${k(building.pledged)}`, `  ${L.paid}: ${k(building.pledgePaid)}`, `  ${L.balance}: ${k(building.pledgeBalance)}`, '',
    L.camp, `  ${L.regs}: ${camp.registrations}`, `  ${L.fees}: ${k(camp.fees)}`, `  ${L.feesPaid}: ${k(camp.paid)}`, '',
    L.other, `  ${L.acts}: ${life.activities}`, `  ${L.mins}: ${life.minutes}`, `  ${L.serm}: ${life.sermons}`, '', L.note].join('\n');
  log(me.id, 'report', 'reports', Y, 'yearly');
  return { year: Y, church, giving, membership, sabbathSchool, welfare, building, camp, life, text: T };
});

route('POST', '/notices/:id/approve', true, ({ me, params }) => {
  const r = getRec('notices', params.id); must(r, 404, 'Not found.'); const d = JSON.parse(r.data);
  must(d.board === 'group' && led(actor(me)) === d.groupKey, 403, 'Only the group leader approves group posts.');
  must(d.status === 'pending', 409, 'Already published.');
  setData(r.id, { ...d, status: 'published', approvedBy: me.name, approvedAt: now() }, me.id, 'approved'); notifyNotice(r.id, { ...d, status: 'published' }, me.id); return { ok: true };
});

// A person applies for membership by transfer themselves. The application goes to the Church Board, led by the Pastor.
route('POST', '/membership/apply', true, ({ me, body }) => {
  must(!q1("SELECT 1 FROM records WHERE col='memberships' AND archived=0 AND created_by=? AND json_extract(data,'$.status')='application'", me.id), 409, 'You already have an application waiting for the Church Board.');
  const fromChurch = String(body.fromChurch || '').trim().slice(0, 150); must(fromChurch, 400, 'Say which church you are transferring from.');
  const id = insertRec('memberships', {
    fullName: me.name, idNumber: me.id_number || '', phone: me.phone, entry: 'transfer', status: 'application', // identity comes from the account, never from the request
    fromChurch, transferLetterRef: String(body.transferLetterRef || '').trim().slice(0, 100), note: String(body.note || '').trim().slice(0, 500), applicantId: me.id,
  }, me.id);
  return { record: out(getRec('memberships', id)) };
});

route('POST', '/memberships/:id/decide', true, ({ me, params, body }) => {
  must(actor(me).eff === 'pastor', 403, 'Transfers are decided by the Church Board, led by the Pastor.');
  const r = getRec('memberships', params.id); must(r, 404, 'Not found.'); const d = JSON.parse(r.data);
  must(d.status === 'application', 409, 'Already decided.');
  const memberNumber = body.approve ? 'M-' + String(nextNo('member')).padStart(4, '0') : null;
  const next = body.approve ? { ...d, status: 'active', memberNumber, boardDecision: 'Approved by Church Board' } : { ...d, status: 'declined', boardDecision: 'Declined by Church Board' };
  setData(r.id, next, me.id, body.approve ? 'transfer approved' : 'transfer declined');
  if (body.approve && d.applicantId) run('UPDATE users SET membership_number=? WHERE id=?', memberNumber, d.applicantId); // the applicant's profile now shows their number
  return { ok: true };
});

route('GET', '/audit', true, ({ me }) => {
  must(isIn(actor(me), 'secretary', 'pastor', 'church_admin'), 403, 'Only the Secretary, Pastor or Church Admin can read the audit trail.');
  return { audit: q('SELECT * FROM audit ORDER BY at DESC LIMIT 200') };
});

// ---------------------------------------------------------------- sermon summary jobs
// A recording (or pasted text) is queued, transcribed, then summarised: a quick summary first, then the full
// congregation summary and the children's version. Results are saved as 'sermons' records (Pastoral Care).
const jobRow = (id) => q1('SELECT * FROM sermon_jobs WHERE id=?', id);
const setJob = (id, patch) => { const k = Object.keys(patch); run(`UPDATE sermon_jobs SET ${k.map((x) => x + '=?').join(',')}, updated_at=? WHERE id=?`, ...k.map((x) => patch[x]), now(), id); };
const listenMinutes = (text) => Math.max(1, Math.round(wordCount(text) / 150));
const jobPublic = (j) => ({ id: j.id, title: j.title, status: j.status, stage: j.stage, error: j.error, quickReady: !!j.quick_id, generalReady: !!j.general_id, kidsReady: !!j.kids_id, createdAt: j.created_at });
const canSeeJob = (me, j) => j.created_by === me.id || policy.create('sermons', actor(me), {});

let queue = Promise.resolve();
const enqueue = (id) => { const store = ctx(); queue = queue.then(() => als.run(store, () => processJob(id))).catch((e) => console.error('job error', e)); }; // each job runs inside its own church

async function processJob(id) {
  let job = jobRow(id); if (!job || job.status === 'done') return;
  try {
    if (!job.transcript) {
      setJob(id, { status: 'transcribing', stage: 'Converting the recording to text…', error: null });
      must(job.audio_path && fs.existsSync(job.audio_path), 422, 'The recording file is missing. Please record or upload again.');
      const text = await transcribeAudio(job.audio_path, job.content_type || 'audio/mp4');
      if (wordCount(text) < 30) throw new ServiceError('Very little speech was found in the recording. Check the microphone and try again.', 422);
      setJob(id, { transcript: text }); job = jobRow(id);
    }
    const tr = job.transcript; const words = wordCount(tr);
    must(words <= 80000, 422, 'The sermon text is too long to summarise.');
    const meta = { title: job.title || 'Sabbath sermon', preacher: job.preacher || '' }; const t = targets(words);
    const save = (audience, title, summary, field) => {
      const rid = insertRec('sermons', { title, preacher: meta.preacher, audience, summary, readingMinutes: listenMinutes(summary), jobId: id }, job.created_by);
      setJob(id, { [field]: rid });
    };
    setJob(id, { status: 'summarizing', stage: 'Writing the quick summary…', error: null });
    if (!job.quick_id) save('quick', meta.title + ' – key points', await summarizeQuick(tr, meta), 'quick_id');
    setJob(id, { stage: 'Writing the full and children’s summaries…' }); job = jobRow(id);
    const [g, k] = await Promise.allSettled([
      job.general_id ? null : summarizeGeneral(tr, meta, t.general),
      job.kids_id ? null : summarizeKids(tr, meta, t.kids),
    ]);
    if (g.status === 'fulfilled' && g.value) save('general', meta.title, g.value, 'general_id');
    if (k.status === 'fulfilled' && k.value) save('kids', meta.title + ' (kids)', k.value, 'kids_id');
    const failed = [g, k].find((x) => x.status === 'rejected');
    if (failed) throw failed.reason;
    setJob(id, { status: 'done', stage: 'Ready', error: null });
    log(job.created_by, 'create', 'sermon_jobs', id, 'summaries ready');
  } catch (e) {
    const friendly = e instanceof ServiceError || e instanceof HttpError ? e.message : 'Something went wrong while summarising. Please try again.';
    if (!(e instanceof ServiceError || e instanceof HttpError)) console.error('sermon job failed', e);
    setJob(id, { status: 'failed', stage: null, error: friendly });
  }
}

const EXT = { 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/m4a': '.m4a', 'audio/aac': '.aac', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/webm': '.webm', 'audio/ogg': '.ogg' };
const readHeader = (req, name) => { try { return decodeURIComponent(String(req.headers[name] || '')).trim().slice(0, 200); } catch { return ''; } };

// Body is either the raw audio file (Content-Type audio/*) or JSON { title, preacher, transcript } for pasted text.
route('POST', '/sermons/jobs', true, async ({ me, req, body, isAudio }) => {
  must(policy.create('sermons', actor(me), {}), 403, 'Only the Pastor, Secretary or Elders can create sermon summaries.');
  must(aiConfigured(), 503, 'The summary service is not set up yet. Please ask the church administrator.');
  must(q1("SELECT COUNT(*) n FROM sermon_jobs WHERE status IN ('queued','transcribing','summarizing')").n < 5, 429, 'Several sermons are already being processed. Please wait a few minutes.');
  const id = uid(); let title, preacher, file = null, ctype = null, transcript = null;
  if (isAudio) {
    title = readHeader(req, 'x-title'); preacher = readHeader(req, 'x-preacher');
    ctype = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    must(Number(req.headers['content-length'] || 0) <= MAX_AUDIO_BYTES, 413, 'The recording is too large.');
    const audioDir = path.join(DATA_DIR, 'sermon-audio', ctx().church.id); fs.mkdirSync(audioDir, { recursive: true });
    file = path.join(audioDir, id + (EXT[ctype] || '.bin')); let bytes = 0;
    try {
      await pipeline(req, async function* (src) { for await (const c of src) { bytes += c.length; if (bytes > MAX_AUDIO_BYTES) throw new HttpError(413, 'The recording is too large.'); yield c; } }, fs.createWriteStream(file));
    } catch (e) { fs.rmSync(file, { force: true }); throw e instanceof HttpError ? e : new HttpError(400, 'The upload was interrupted. Please try again.'); }
    if (bytes < 10 * 1024) { fs.rmSync(file, { force: true }); throw new HttpError(422, 'The recording is empty.'); }
  } else {
    title = String(body.title || '').trim().slice(0, 200); preacher = String(body.preacher || '').trim().slice(0, 200);
    transcript = String(body.transcript || '').trim();
    must(wordCount(transcript) >= 30, 400, 'Paste the sermon text (at least a few sentences).');
  }
  run('INSERT INTO sermon_jobs(id,created_by,title,preacher,status,stage,audio_path,content_type,transcript,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, me.id, title || 'Sabbath sermon', preacher || me.name, 'queued', 'Waiting to start…', file, ctype, transcript, now(), now());
  log(me.id, 'create', 'sermon_jobs', id, isAudio ? 'audio' : 'text');
  enqueue(id);
  return { job: jobPublic(jobRow(id)) };
}, { raw: true });

route('GET', '/sermons/jobs/:id', true, ({ me, params }) => {
  const j = jobRow(params.id); must(j && canSeeJob(me, j), 404, 'Not found.'); return { job: jobPublic(j) };
});
route('POST', '/sermons/jobs/:id/retry', true, ({ me, params }) => {
  const j = jobRow(params.id); must(j && canSeeJob(me, j), 404, 'Not found.'); must(j.status === 'failed', 409, 'This job is not in a failed state.');
  setJob(j.id, { status: 'queued', stage: 'Waiting to start…', error: null }); enqueue(j.id); return { job: jobPublic(jobRow(j.id)) };
});
route('GET', '/sermons/jobs/:id/transcript', true, ({ me, params }) => {
  const j = jobRow(params.id); must(j && canSeeJob(me, j) && j.transcript, 404, 'Not found.'); return { transcript: j.transcript };
});

// Pick up anything that was interrupted by a restart.
for (const c of pq("SELECT * FROM churches WHERE status='active'")) inChurch(c, () => { for (const j of q("SELECT id FROM sermon_jobs WHERE status IN ('queued','transcribing','summarizing')")) enqueue(j.id); });


// ---------------------------------------------------------------- reminders: gentle daily nudges when something has waited too long
// REMINDERS=off switches this off. A nudge for each kind is sent at most once per REMINDER_EVERY_HOURS (default 24), only in the daytime (Kenya time)
// unless REMINDER_ANYTIME=1. Counts only: the push never carries names or amounts. Every nudge is written to reminder_log (never deleted).
const REMIND = { off: process.env.REMINDERS === 'off', afterH: Number(process.env.REMINDER_AFTER_HOURS || 48), everyH: Number(process.env.REMINDER_EVERY_HOURS || 24), checkMs: Number(process.env.REMINDER_CHECK_MS || 3600e3) };
const kenyaHour = () => (new Date().getUTCHours() + 3) % 24;
function runReminders() { // inside a church context
  const cutoff = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const due = (kind) => { const r = q1('SELECT last_at FROM reminder_log WHERE kind=?', kind); return !r || Date.parse(r.last_at) <= Date.now() - REMIND.everyH * 3600e3 + 1000; };
  const mark = (kind, n) => run('INSERT INTO reminder_log(kind,last_at,count) VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET last_at=excluded.last_at, count=count+1', kind, now(), n);
  const days = Math.max(1, Math.round(REMIND.afterH / 24));
  const sent = [];
  const go = (kind, n, roles, push) => { if (!n || !due(kind)) return; mark(kind, n); notifyUsers(usersWhere((a) => roles.includes(a.eff)).map((u) => u.id), push, { n, days }, { screen: push === 'remind_payments' ? 'payments' : push === 'remind_transfers' ? 'membership' : push === 'remind_roles' ? 'roles' : 'adminMembers' }); sent.push(kind); };
  const old = cutoff(REMIND.afterH);
  go('payments', q1("SELECT COUNT(*) n FROM records WHERE col='payments' AND archived=0 AND json_extract(data,'$.status')='pending' AND created_at<?", old).n, ['treasurer'], 'remind_payments');
  go('joins', q1("SELECT COUNT(*) n FROM users WHERE archived=0 AND join_status='pending' AND created_at<?", old).n, ['church_admin'], 'remind_joins');
  go('roles', q1("SELECT COUNT(*) n FROM users WHERE archived=0 AND join_status='approved' AND role_status='pending' AND created_at<?", old).n, ['secretary', 'pastor', 'church_admin'], 'remind_roles');
  go('transfers', q1("SELECT COUNT(*) n FROM records WHERE col='memberships' AND archived=0 AND json_extract(data,'$.status')='application' AND created_at<?", cutoff(REMIND.afterH + 24)).n, ['pastor'], 'remind_transfers');
  return sent;
}
function remindersTick() {
  if (REMIND.off) return;
  if (process.env.REMINDER_ANYTIME !== '1' && (kenyaHour() < 7 || kenyaHour() >= 20)) return;
  for (const c of pq("SELECT * FROM churches WHERE status='active'")) { try { inChurch(c, () => runReminders()); } catch (e) { console.error('Reminders failed for', c.name + ':', e.message); } }
}
if (!REMIND.off) { setTimeout(remindersTick, Math.min(REMIND.checkMs, 60e3)).unref(); setInterval(remindersTick, REMIND.checkMs).unref(); }

// ---------------------------------------------------------------- support chat counters (used by /me and the console)
function supportUnread(churchId, reader) {
  const r = pq1('SELECT last_at FROM support_reads WHERE church_id=? AND reader=?', churchId, reader);
  const fromKind = reader === 'admin' ? 'developer' : 'admin';
  return pq1('SELECT COUNT(*) n FROM support_messages WHERE church_id=? AND from_kind=? AND at>?', churchId, fromKind, r ? r.last_at : '').n;
}

installClerkTools({ route, must, HttpError, q, q1, run, log, actor, isIn, getRec, setData, out, nextNo, receiptsOf, sumBy, round2, keDate, now, ctx, issueReceipt, mpesaOn });

// ---------------------------------------------------------------- developer console + church admin API (see console-api.mjs)
if (SANDBOX) installSandbox({ route, must, HttpError, sign, normPhone, pq1, prun, plog, uid, now, churchOf, inChurch, q1, run, joinChurch, memberToken, churchPublic, publicUser, LEADER_ROLES, getDefaultChurch: () => defaultChurch, limited });
installConsole({ notifyUsers, notifyAdmins, route, must, HttpError, P, pq, pq1, prun, plog, uid, now, sign, hash, checkOtp, useOtp, limited, normPhone, churchPublic, churchOf, churchByNumber, inChurch, ctx, q, q1, run, log, actor, publicUser, archiveUser, joinChurch, supportUnread, isIn, LEADER_ROLES, sendSms, DEV, DATA_DIR });

// ---------------------------------------------------------------- http server
const CORS_ORIGIN = process.env.ALLOWED_ORIGIN || (DEV ? '*' : '');
const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    ...(CORS_ORIGIN ? { 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Title, X-Preacher', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' } : {}) });
  res.end(JSON.stringify(obj));
};
const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'DELETE') return send(res, 405, { error: errText(reqLang(req), 'Archive only: nothing in this system can be deleted. Use the archive action.') });
    if (req.method === 'PUT' || req.method === 'PATCH') return send(res, 405, { error: errText(reqLang(req), 'Records are changed only through specific actions.') });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/health') { pq1('SELECT 1'); return send(res, 200, { ok: true, sms: smsConfigured() || DEV, ai: aiConfigured(), mpesa: mpesaOn(), persistent: DEV || PERSISTENT, sandbox: SANDBOX }); }
    const route_ = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!route_) { req.resume(); return send(res, 404, { error: errText(reqLang(req), 'Not found.') }); }
    const m = route_.re.exec(url.pathname);
    let me = null, store = { church: null, db: null }, dev = null;
    if (route_.auth === 'dev') { // developer console routes: a developer token, no church selected
      const t = verifyToken((req.headers.authorization || '').replace(/^Bearer /, '')); must(t && t.dev, 401, 'Please sign in.');
      dev = pq1("SELECT * FROM developers WHERE id=? AND status='active'", t.dev); must(dev, 401, 'Please sign in.');
    } else if (route_.auth) { // sign-in is checked before any upload is accepted
      const t = verifyToken((req.headers.authorization || '').replace(/^Bearer /, '')); must(t && t.uid && t.ch, 401, 'Please sign in.');
      const c = churchOf(t.ch); must(c && c.status === 'active', 401, 'Please sign in.');
      store = { church: c, db: P.churchDb(c) };
      me = als.run(store, () => q1('SELECT * FROM users WHERE id=? AND archived=0', t.uid)); must(me, 401, 'Please sign in.');
      const bound = pq1("SELECT 1 FROM bindings WHERE phone=? AND church_id=? AND status='active'", me.phone, c.id); must(bound, 401, 'Please sign in.'); // a moved person's old token stops working
      const hl = req.headers['x-lang'] ? reqLang(req) : null; if (hl && hl !== me.lang) { als.run(store, () => run('UPDATE users SET lang=? WHERE id=?', hl, me.id)); me.lang = hl; }
      if (me.join_status === 'pending' && !route_.pendingOk) throw Object.assign(new HttpError(403, 'Waiting for the church admin to approve you.'), { extra: { code: 'join_pending' } });
    }
    const ctype = String(req.headers['content-type'] || '').toLowerCase();
    const isAudio = route_.raw && (ctype.startsWith('audio/') || ctype.startsWith('application/octet-stream'));
    let body = {};
    if (!isAudio) {
      let raw = ''; for await (const c of req) { raw += c; if (raw.length > 4e6) throw new HttpError(413, 'Too large.'); }
      if (raw) { try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON.'); } }
    }
    const result = await als.run(store, () => route_.fn({ me, dev, req, res, isAudio, ip: clientIp(req), params: m.groups || {}, query: url.searchParams, body }));
    if (result && result.__html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' }); return res.end(result.__html); }
    return send(res, 200, result);
  } catch (e) {
    // If we answered before reading the whole upload, close the connection so leftover bytes cannot break the client's next request.
    if (!req.complete) res.setHeader('Connection', 'close');
    const L = reqLang(req);
    if (e instanceof HttpError || e instanceof ServiceError) return send(res, e.code, { error: errText(L, e.message), ...(e.extra || {}) });
    if (Number.isInteger(e.code) && e.code >= 400 && e.code < 500) return send(res, e.code, { error: errText(L, e.message) }); // validation errors raised by platform.mjs
    console.error(e); send(res, 500, { error: errText(L, 'Something went wrong on the server.') });
  }
});
server.keepAliveTimeout = 65 * 1000; // Node's 5s default drops idle connections that reverse proxies and phones still try to reuse
server.headersTimeout = 66 * 1000;
server.requestTimeout = 30 * 60 * 1000; // allow slow uploads of long recordings on mobile data
// Church records and receipts live in files under DATA_DIR. On a host that wipes the disk on every update, or runs
// several copies of the app (many "app platforms" do), that data would silently disappear or split in two.
// So in production the operator must confirm the folder is on a disk that survives updates and has one running copy.
if (!DEV && !PERSISTENT && !EPHEMERAL_OK) {
  console.error('\nREFUSING TO START: production needs PERSISTENT_STORAGE=yes (DATA_DIR on a disk that survives updates, one running copy).\n' +
    'For a throw-away trial only, set ALLOW_EPHEMERAL=yes: everything is lost on every update. See deploy/CHAJIO.md.\n');
  process.exit(1);
}
if (!DEV && !PERSISTENT) console.warn('WARNING: ALLOW_EPHEMERAL=yes: trial mode. All data is lost when the app restarts or updates. Do not enter real church data.');
if (SANDBOX && PERSISTENT) {
  console.error('\nREFUSING TO START: SANDBOX_ACCESS=yes lets the team in without a code, so it must never run on real church data (PERSISTENT_STORAGE=yes).\n');
  process.exit(1);
}
if (SANDBOX && !DEV) console.warn('WARNING: SANDBOX_ACCESS=yes: anyone with the web address can enter with the team test numbers. Made-up data only.');
server.listen(PORT, () => console.log(`Church Connect API on :${PORT} (${DEV ? 'DEV mode' : 'production'}; data: ${path.resolve(DATA_DIR)})`));
const shutdown = () => { console.log('Shutting down…'); server.close(() => { P.closeAll(); process.exit(0); }); setTimeout(() => process.exit(0), 10000).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
