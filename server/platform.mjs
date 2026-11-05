// Church Connect – the platform layer.
//
// One *platform* database (platform.db) knows which churches exist, which developers run the platform, which phone
// belongs to which church (the "binding"), and the support chat. Every church then has its OWN database file, so
// churches cannot see each other's data even by mistake: a request opens exactly one church database and nothing else.
//
// Archive-only here too: churches, bindings, developers and chat messages can be archived but never deleted.
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const uid = () => crypto.randomBytes(9).toString('base64url');
export const now = () => new Date().toISOString();

// ---------------------------------------------------------------- church numbers
// A church number is 7 digits: six random digits plus a check digit, shown as 482-7391. The check digit catches a mistyped number
// before the server is even asked. The number is a join key, not a password: new members still need the church admin's approval.
const luhn = (digits) => { let sum = 0; for (let i = 0; i < digits.length; i++) { let d = Number(digits[digits.length - 1 - i]); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; } return (10 - (sum % 10)) % 10; };
export const normNumber = (s) => String(s ?? '').replace(/\D/g, '');
export const validNumber = (s) => { const n = normNumber(s); return /^\d{7}$/.test(n) && luhn(n.slice(0, 6)) === Number(n[6]); };
export const fmtNumber = (s) => { const n = normNumber(s); return n.length === 7 ? n.slice(0, 3) + '-' + n.slice(3) : n; };
export const makeNumber = () => { const six = String(crypto.randomInt(100000, 1000000)); return six + luhn(six); };

// ---------------------------------------------------------------- default settings every new church starts with (the "template")
export const PAYMENT_CATEGORIES = ['Tithe', 'Offering', '13th Sabbath', 'Church Budget', 'Field Advance', 'Camp Meeting', 'Church Building', 'Welfare / Benevolent', 'Other'];
export const TEMPLATE_DEFAULT = {
  paybill: '', accountHint: 'Your name', categories: PAYMENT_CATEGORIES, language: 'en', motto: '',
  requireJoinApproval: true, // a new member who enters the church number waits for the church admin to approve them
};
const SETTING_KEYS = Object.keys(TEMPLATE_DEFAULT);
export function cleanSettings(s, base = TEMPLATE_DEFAULT) {
  const out = { ...base };
  if (typeof s?.paybill === 'string') out.paybill = s.paybill.replace(/[^\d]/g, '').slice(0, 10);
  if (typeof s?.accountHint === 'string') out.accountHint = s.accountHint.trim().slice(0, 60);
  if (typeof s?.motto === 'string') out.motto = s.motto.trim().slice(0, 120);
  if (s?.language === 'en' || s?.language === 'sw') out.language = s.language;
  if (typeof s?.requireJoinApproval === 'boolean') out.requireJoinApproval = s.requireJoinApproval;
  if (Array.isArray(s?.categories)) {
    const c = [...new Set(s.categories.map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
    if (c.length) out.categories = c;
  }
  return out;
}
export { SETTING_KEYS };

// ---------------------------------------------------------------- the church database (one per church)
export const CHURCH_SCHEMA = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT, id_number TEXT, membership_number TEXT,
  requested_role TEXT NOT NULL DEFAULT 'member',   -- what the person asked for at sign-up
  role TEXT NOT NULL DEFAULT 'member',             -- what they are actually allowed (approved by Secretary/Pastor/Church Admin)
  role_status TEXT NOT NULL DEFAULT 'approved',    -- approved | pending | declined
  former_roles TEXT NOT NULL DEFAULT '[]', groups TEXT NOT NULL DEFAULT '[]',
  church TEXT, district TEXT, station TEXT, conference TEXT, county TEXT,
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  join_status TEXT NOT NULL DEFAULT 'approved',    -- approved | pending (waiting for the church admin after entering the church number)
  lang TEXT NOT NULL DEFAULT 'en',
  guide_seen TEXT NOT NULL DEFAULT '');            -- the role whose first-run guide this person has already seen                -- en | sw: the language this person uses; SMS and push messages to them follow it
CREATE TABLE IF NOT EXISTS push_tokens(token TEXT PRIMARY KEY, user_id TEXT NOT NULL, platform TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS push_no_delete BEFORE DELETE ON push_tokens BEGIN SELECT RAISE(ABORT,'Archive only: device registrations are switched off, not deleted'); END;
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Offline outbox: a phone that wrote something offline sends it with a one-off key. If the same key arrives again (a retry after a lost answer), the first record is returned and nothing is added twice.
CREATE TABLE IF NOT EXISTS idempotency(key TEXT NOT NULL, user_id TEXT NOT NULL, col TEXT NOT NULL, record_id TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(key, user_id));
CREATE TRIGGER IF NOT EXISTS idem_no_delete BEFORE DELETE ON idempotency BEGIN SELECT RAISE(ABORT,'Archive only: sync history cannot be deleted'); END;
CREATE TABLE IF NOT EXISTS reminder_log(kind TEXT PRIMARY KEY, last_at TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS reminder_no_delete BEFORE DELETE ON reminder_log BEGIN SELECT RAISE(ABORT,'Archive only: reminder history cannot be deleted'); END;
CREATE TABLE IF NOT EXISTS records(
  id TEXT PRIMARY KEY, col TEXT NOT NULL, data TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT, archived_by TEXT, archive_reason TEXT);
CREATE INDEX IF NOT EXISTS records_col ON records(col, created_at);
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY, at TEXT NOT NULL, by TEXT, action TEXT NOT NULL, col TEXT, rid TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sermon_jobs(
  id TEXT PRIMARY KEY, created_by TEXT NOT NULL, title TEXT, preacher TEXT, status TEXT NOT NULL, stage TEXT, error TEXT,
  audio_path TEXT, content_type TEXT, transcript TEXT, quick_id TEXT, general_id TEXT, kids_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS jobs_no_delete BEFORE DELETE ON sermon_jobs BEGIN SELECT RAISE(ABORT,'Archive only: sermon jobs cannot be deleted'); END;
CREATE TABLE IF NOT EXISTS mpesa_tx(
  trans_id TEXT PRIMARY KEY, amount REAL NOT NULL, bill_ref TEXT, msisdn TEXT, first_name TEXT, middle_name TEXT, last_name TEXT,
  trans_time TEXT, shortcode TEXT, raw TEXT NOT NULL, received_at TEXT NOT NULL, payment_id TEXT);
CREATE TRIGGER IF NOT EXISTS mpesa_no_delete BEFORE DELETE ON mpesa_tx BEGIN SELECT RAISE(ABORT,'Archive only: M-Pesa records cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS records_no_delete BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'Archive only: records cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS users_no_delete   BEFORE DELETE ON users   BEGIN SELECT RAISE(ABORT,'Archive only: users cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete   BEFORE DELETE ON audit   BEGIN SELECT RAISE(ABORT,'Audit log cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update   BEFORE UPDATE ON audit   BEGIN SELECT RAISE(ABORT,'Audit log cannot be changed'); END;
`;

const PLATFORM_SCHEMA = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS churches(
  id TEXT PRIMARY KEY, number TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',            -- active | suspended | archived
  admin_phone TEXT, db_file TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, cloned_from TEXT,
  district TEXT, station TEXT, conference TEXT, county TEXT, note TEXT,
  created_by TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bindings(
  id TEXT PRIMARY KEY, phone TEXT NOT NULL, church_id TEXT NOT NULL, user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',            -- active | archived (the person moved or was archived)
  since TEXT NOT NULL, until TEXT, reason TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS bindings_one_active ON bindings(phone) WHERE status='active';
CREATE TABLE IF NOT EXISTS developers(
  id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT, created_at TEXT NOT NULL, archived_at TEXT);
CREATE TABLE IF NOT EXISTS otps(phone TEXT PRIMARY KEY, hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS template(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS support_messages(
  id TEXT PRIMARY KEY, church_id TEXT NOT NULL, from_kind TEXT NOT NULL,   -- 'admin' | 'developer'
  from_id TEXT, from_name TEXT, body TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS support_by_church ON support_messages(church_id, at);
CREATE TABLE IF NOT EXISTS support_reads(church_id TEXT NOT NULL, reader TEXT NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY(church_id, reader));
CREATE TABLE IF NOT EXISTS paudit(id TEXT PRIMARY KEY, at TEXT NOT NULL, by TEXT, action TEXT NOT NULL, church_id TEXT, detail TEXT);
CREATE TRIGGER IF NOT EXISTS churches_no_delete BEFORE DELETE ON churches BEGIN SELECT RAISE(ABORT,'Archive only: churches cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS bindings_no_delete BEFORE DELETE ON bindings BEGIN SELECT RAISE(ABORT,'Archive only: bindings cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS developers_no_delete BEFORE DELETE ON developers BEGIN SELECT RAISE(ABORT,'Archive only: developers cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS support_no_delete BEFORE DELETE ON support_messages BEGIN SELECT RAISE(ABORT,'Archive only: messages cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS support_no_update BEFORE UPDATE ON support_messages BEGIN SELECT RAISE(ABORT,'Messages cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS paudit_no_delete BEFORE DELETE ON paudit BEGIN SELECT RAISE(ABORT,'Audit log cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS paudit_no_update BEFORE UPDATE ON paudit BEGIN SELECT RAISE(ABORT,'Audit log cannot be changed'); END;
`;

export function openPlatform(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'churches'), { recursive: true });
  const pdb = new DatabaseSync(path.join(dataDir, 'platform.db'));
  pdb.exec(PLATFORM_SCHEMA);
  const pq = (sql, ...a) => pdb.prepare(sql).all(...a);
  const pq1 = (sql, ...a) => pdb.prepare(sql).get(...a);
  const prun = (sql, ...a) => pdb.prepare(sql).run(...a);
  const plog = (by, action, churchId, detail = '') => prun('INSERT INTO paudit VALUES(?,?,?,?,?,?)', uid(), now(), by, action, churchId || null, detail);

  // ---- template
  const getTemplate = () => { const r = pq1('SELECT data FROM template WHERE id=1'); return cleanSettings(r ? JSON.parse(r.data) : {}); };
  const setTemplate = (s) => { const d = JSON.stringify(cleanSettings(s, getTemplate())); prun('INSERT INTO template VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', d); return getTemplate(); };

  // ---- church databases: opened on demand, kept open
  const open = new Map();
  const filePath = (c) => (path.isAbsolute(c.db_file) ? c.db_file : path.join(dataDir, c.db_file));
  function churchDb(c) {
    let h = open.get(c.id);
    if (!h) {
      const db = new DatabaseSync(filePath(c));
      db.exec(CHURCH_SCHEMA);
      // Databases made before multi-church support gain the new columns/tables here.
      if (!db.prepare('PRAGMA table_info(users)').all().some((x) => x.name === 'join_status')) db.exec("ALTER TABLE users ADD COLUMN join_status TEXT NOT NULL DEFAULT 'approved'");
      if (!db.prepare('PRAGMA table_info(users)').all().some((x) => x.name === 'lang')) db.exec("ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'");
      if (!db.prepare('PRAGMA table_info(users)').all().some((x) => x.name === 'guide_seen')) db.exec("ALTER TABLE users ADD COLUMN guide_seen TEXT NOT NULL DEFAULT ''");
      h = { db }; open.set(c.id, h);
    }
    return h.db;
  }
  const settingsOf = (c) => {
    const rows = churchDb(c).prepare('SELECT key,value FROM settings').all();
    const s = {}; for (const r of rows) { try { s[r.key] = JSON.parse(r.value); } catch { /* ignore a damaged value */ } }
    return cleanSettings(s, getTemplate());
  };
  const saveSettings = (c, s) => {
    const db = churchDb(c); const merged = cleanSettings(s, settingsOf(c));
    for (const k of SETTING_KEYS) db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(merged[k]));
    return merged;
  };

  // ---- creating ("cloning") a church: a fresh, empty, independent database seeded from the template (or from another church's settings)
  function createChurch({ name, number, adminPhone, district, station, conference, county, cloneFrom, by, dbFile, isDefault, note }) {
    const nm = String(name || '').trim().slice(0, 120);
    if (nm.length < 3) throw Object.assign(new Error('Write the church name (at least 3 letters).'), { code: 400 });
    let num = number ? normNumber(number) : '';
    if (num) {
      if (!validNumber(num)) throw Object.assign(new Error('That church number is not valid. It must be 7 digits ending in the correct check digit.'), { code: 400 });
      if (pq1('SELECT 1 FROM churches WHERE number=?', num)) throw Object.assign(new Error('That church number is already assigned to another church.'), { code: 409 });
    } else { do { num = makeNumber(); } while (pq1('SELECT 1 FROM churches WHERE number=?', num)); }
    let base = getTemplate();
    if (cloneFrom) {
      const src = pq1('SELECT * FROM churches WHERE id=?', cloneFrom);
      if (!src) throw Object.assign(new Error('The church to copy from was not found.'), { code: 404 });
      base = settingsOf(src);
    }
    const id = uid(); const file = dbFile || path.join('churches', id + '.db');
    prun('INSERT INTO churches(id,number,name,status,admin_phone,db_file,is_default,cloned_from,district,station,conference,county,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, num, nm, 'active', adminPhone || null, file, isDefault ? 1 : 0, cloneFrom || null, district || '', station || '', conference || '', county || '', note || '', by || 'system', now());
    const c = pq1('SELECT * FROM churches WHERE id=?', id);
    saveSettings(c, { ...base, ...(base === getTemplate() ? {} : {}) });
    plog(by || 'system', 'church.create', id, nm + ' #' + num + (cloneFrom ? ' (cloned settings from ' + cloneFrom + ')' : ''));
    return c;
  }

  const closeAll = () => { for (const h of open.values()) { try { h.db.close(); } catch { /* already closed */ } } try { pdb.close(); } catch { /* already closed */ } };
  return { pdb, pq, pq1, prun, plog, getTemplate, setTemplate, churchDb, settingsOf, saveSettings, createChurch, closeAll, filePath, dataDir };
}
