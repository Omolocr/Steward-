// Safe backup of the whole platform: the platform database, EVERY church's database, and the saved sermon recordings.
//   node backup.mjs            (one backup now; the Docker setup runs it every day)
//
// Each backup is a folder  backups/snapshot-<date-time>/  holding  platform.db  and  churches/<church id>.db .
// To restore: copy the contents of one snapshot folder into an empty DATA_DIR (and sermon-audio/ beside it), then start the server.
//
// - Databases are copied with SQLite's VACUUM INTO, which is safe while the server is running.
// - Every copy is opened again and checked (integrity_check) before the snapshot is kept.
// - Sermon recordings are mirrored into backups/sermon-audio/ if not there already (existing copies are never touched).
// - Only OLD SNAPSHOT FOLDERS beyond BACKUP_KEEP are pruned, never church records or recordings.
// - BACKUP_HOOK: optional shell command run after a good backup, e.g. to copy it off the server:
//       BACKUP_HOOK='rclone copy "$BACKUP_FILE" remote:church-backups/'     ($BACKUP_FILE is the snapshot folder)
import { DatabaseSync } from 'node:sqlite';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.DATA_DIR || '.';
const OUT = process.env.BACKUP_DIR || path.join(DATA, 'backups');
const KEEP = Math.max(7, Number(process.env.BACKUP_KEEP || 60));
const AUDIO = path.join(DATA, 'sermon-audio');
const q = (p) => p.replace(/'/g, "''");

function copyDb(from, to) {
  const src = new DatabaseSync(from);
  try { src.exec(`VACUUM INTO '${q(to)}'`); } finally { src.close(); }
  const chk = new DatabaseSync(to);
  try { const r = chk.prepare('PRAGMA integrity_check').get().integrity_check; if (r !== 'ok') { throw new Error('Backup of ' + path.basename(from) + ' failed its integrity check: ' + r); } }
  finally { chk.close(); }
}
function copyTree(from, to, counter) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copyTree(a, b, counter); }
    else if (!fs.existsSync(b)) { fs.copyFileSync(a, b); counter.n++; }
  }
}

let dest;
try {
  const platform = path.join(DATA, 'platform.db');
  if (!fs.existsSync(platform)) throw new Error('Database not found: ' + platform);
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); // 2026-10-20-03-15-42
  dest = path.join(OUT, `snapshot-${stamp}`);
  if (fs.existsSync(dest)) throw new Error('A backup with this exact time already exists: ' + dest);
  fs.mkdirSync(path.join(dest, 'churches'), { recursive: true });

  copyDb(platform, path.join(dest, 'platform.db'));
  // read the list of churches from the COPY, so what we back up matches what the copy says
  const pdb = new DatabaseSync(path.join(dest, 'platform.db'));
  let churches, devCount;
  try { churches = pdb.prepare('SELECT id, name, db_file FROM churches').all(); devCount = pdb.prepare("SELECT COUNT(*) n FROM developers WHERE status='active'").get().n; } finally { pdb.close(); }
  let records = 0;
  const fix = [];
  for (const c of churches) {
    const from = path.isAbsolute(c.db_file) ? c.db_file : path.join(DATA, c.db_file);
    if (!fs.existsSync(from)) throw new Error(`Database for church "${c.name}" not found: ${from}`);
    const rel = path.join('churches', c.id + '.db');
    copyDb(from, path.join(dest, rel));
    const cdb = new DatabaseSync(path.join(dest, rel));
    try { records += cdb.prepare('SELECT COUNT(*) n FROM records').get().n; } finally { cdb.close(); }
    fix.push([rel, c.id]);
  }
  // inside the backup, every church file lives next to the platform file, so the snapshot can be restored anywhere
  const pw = new DatabaseSync(path.join(dest, 'platform.db'));
  try { for (const [rel, id] of fix) pw.prepare('UPDATE churches SET db_file=? WHERE id=?').run(rel, id); } finally { pw.close(); }

  const audio = { n: 0 };
  if (fs.existsSync(AUDIO)) { const aOut = path.join(OUT, 'sermon-audio'); fs.mkdirSync(aOut, { recursive: true }); copyTree(AUDIO, aOut, audio); }

  const snaps = fs.readdirSync(OUT).filter((f) => /^snapshot-/.test(f)).sort();
  for (const old of snaps.slice(0, Math.max(0, snaps.length - KEEP))) fs.rmSync(path.join(OUT, old), { recursive: true });

  console.log(`Backup OK: ${dest} (${churches.length} churches, ${devCount} developers, ${records} records, ${audio.n} new recordings copied, ${Math.min(snaps.length, KEEP)} snapshots kept)`);
  if (process.env.BACKUP_HOOK) execSync(process.env.BACKUP_HOOK, { stdio: 'inherit', env: { ...process.env, BACKUP_FILE: dest, BACKUP_DIR: OUT } });
} catch (e) {
  if (dest && fs.existsSync(dest)) { try { fs.renameSync(dest, dest + '.INCOMPLETE'); } catch { /* leave it */ } }
  console.error('BACKUP FAILED:', e.message);
  process.exit(1);
}
