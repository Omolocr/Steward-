// Restore a backup snapshot into the data folder.
//   node restore.mjs backups/snapshot-2026-11-05-03-00-00        (DATA_DIR says where the server keeps its data)
// STOP THE SERVER FIRST (deploy/restore.sh does that for you).
// Nothing is deleted: the data that is there now is moved into  DATA_DIR/before-restore-<time>/  so a wrong restore can be undone.
// The snapshot is checked first (every database must pass SQLite's integrity check); if anything is wrong, nothing is touched.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.resolve(process.env.DATA_DIR || '.');
const snap = process.argv[2] && path.resolve(process.argv[2]);
const fail = (m) => { console.error('RESTORE FAILED: ' + m); process.exit(1); };
if (!snap) fail('Say which backup: node restore.mjs backups/snapshot-YYYY-MM-DD-HH-MM-SS');
if (!fs.existsSync(path.join(snap, 'platform.db'))) fail(`${snap} is not a backup snapshot (no platform.db inside).`);

// ---- check the snapshot before touching anything
const checked = [];
const check = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { const r = db.prepare('PRAGMA integrity_check').get().integrity_check; if (r !== 'ok') fail(`${path.basename(file)} is damaged (${r}). Use an older snapshot.`); } finally { db.close(); }
  checked.push(path.relative(snap, file));
};
check(path.join(snap, 'platform.db'));
let churches = [], records = 0;
{
  const pdb = new DatabaseSync(path.join(snap, 'platform.db'), { readOnly: true });
  try { churches = pdb.prepare('SELECT id,name,db_file FROM churches').all(); } finally { pdb.close(); }
}
for (const c of churches) {
  if (path.isAbsolute(c.db_file)) fail(`${c.name} points to an absolute path (${c.db_file}); this snapshot was not made by backup.mjs.`);
  const f = path.join(snap, c.db_file);
  if (!fs.existsSync(f)) fail(`The snapshot is missing the database of ${c.name} (${c.db_file}).`);
  check(f);
  const cdb = new DatabaseSync(f, { readOnly: true });
  try { records += cdb.prepare('SELECT COUNT(*) n FROM records').get().n; } finally { cdb.close(); }
}

// ---- move what is there now aside (never delete), then copy the snapshot in
fs.mkdirSync(DATA, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const aside = path.join(DATA, 'before-restore-' + stamp);
const existing = ['platform.db', 'platform.db-wal', 'platform.db-shm', 'churches', 'church.db', 'church.db-wal', 'church.db-shm'].filter((n) => fs.existsSync(path.join(DATA, n)));
if (existing.length) { fs.mkdirSync(aside, { recursive: true }); for (const n of existing) fs.renameSync(path.join(DATA, n), path.join(aside, n)); }
fs.copyFileSync(path.join(snap, 'platform.db'), path.join(DATA, 'platform.db'));
for (const c of churches) { const to = path.join(DATA, c.db_file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(snap, c.db_file), to); }

// ---- sermon recordings: sit beside the snapshots; only missing files are copied, nothing is overwritten
let audio = 0;
const audioFrom = path.join(path.dirname(snap), 'sermon-audio');
const copyMissing = (a, b) => { for (const e of fs.readdirSync(a, { withFileTypes: true })) { const x = path.join(a, e.name), y = path.join(b, e.name); if (e.isDirectory()) { fs.mkdirSync(y, { recursive: true }); copyMissing(x, y); } else if (!fs.existsSync(y)) { fs.copyFileSync(x, y); audio++; } } };
if (fs.existsSync(audioFrom)) { fs.mkdirSync(path.join(DATA, 'sermon-audio'), { recursive: true }); copyMissing(audioFrom, path.join(DATA, 'sermon-audio')); }

console.log(`Restore OK from ${path.basename(snap)}: ${churches.length} churches, ${records} records, ${audio} recordings copied back.`);
console.log(existing.length ? `The data that was there before is kept in ${aside}` : 'There was no earlier data.');
console.log('Now start the server.');
