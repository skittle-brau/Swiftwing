import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/lib/db.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'cli.js');

test('backup snapshots the live database and keeps only the newest N', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'swiftwing-backup-'));
  const env = { ...process.env, UPLOAD_DIR: path.join(dir, 'uploads'), DB_PATH: '' };
  delete env.DB_PATH;
  execFileSync(process.execPath, [CLI, 'user', 'add', 'tom', '--admin'], { env, input: 'backup test phrase 1\n' });

  // Keep the database open and mid-use (WAL mode) while backing up, as the running app would.
  const live = openDatabase(path.join(dir, 'swiftwing.db'));
  live.exec("INSERT INTO groups (name, created_at) VALUES ('Live write', 0)");
  const run = () => execFileSync(process.execPath, [CLI, 'backup', '--keep=2'], { env, encoding: 'utf8' });
  const out = run();
  assert.match(out, /Backed up .*swiftwing\.db → .*backups\/swiftwing-\d{4}-\d{2}-\d{2}-\d{6}\.db/);
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 1100)); // file names have one-second resolution
    run();
  }
  live.close();

  const files = readdirSync(path.join(dir, 'backups')).sort();
  assert.equal(files.length, 2);
  const copy = openDatabase(path.join(dir, 'backups', files.at(-1)));
  assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(copy.prepare('SELECT username FROM users').all().map((r) => r.username), ['tom']);
  assert.deepEqual(copy.prepare('SELECT name FROM groups').all().map((r) => r.name), ['Live write']);
  copy.close();
});
