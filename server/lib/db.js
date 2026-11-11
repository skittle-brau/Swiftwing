/**
 * SQLite storage (Node's built-in node:sqlite, no native dependencies).
 *
 * Holds users, login sessions, failed-login tracking and email templates.
 * The file lives next to the uploads folder by default:
 *   /var/lib/atelier-email-builder/atelier.db
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Load node:sqlite without printing its "experimental feature" warning on every start. */
function loadSqlite() {
  const original = process.emitWarning;
  process.emitWarning = function (warning, ...args) {
    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
    if (type === 'ExperimentalWarning' && /SQLite/i.test(String(warning?.message ?? warning))) return;
    return original.call(process, warning, ...args);
  };
  try {
    return require('node:sqlite');
  } finally {
    process.emitWarning = original;
  }
}

const MIGRATIONS = [
  // 1: initial schema
  `
  CREATE TABLE users (
    id                  INTEGER PRIMARY KEY,
    username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash       TEXT NOT NULL,
    role                TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
    created_at          INTEGER NOT NULL,
    last_login_at       INTEGER,
    password_changed_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id_hash      TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    ip           TEXT,
    user_agent   TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE login_failures (
    username     TEXT PRIMARY KEY COLLATE NOCASE,
    count        INTEGER NOT NULL,
    last_at      INTEGER NOT NULL,
    locked_until INTEGER
  );
  CREATE TABLE login_attempts_ip (
    ip TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX login_attempts_ip_ip_at ON login_attempts_ip(ip, at);
  CREATE TABLE templates (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    doc         TEXT NOT NULL,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  `,
];

/** Default database path: DB_PATH, else next to UPLOAD_DIR, else <root>/data/atelier.db. */
export function defaultDbPath(root) {
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  if (process.env.UPLOAD_DIR) return path.join(path.dirname(path.resolve(process.env.UPLOAD_DIR)), 'atelier.db');
  return path.join(path.resolve(root), 'data', 'atelier.db');
}

export function openDatabase(file) {
  const { DatabaseSync } = loadSqlite();
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');

  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

/** Run fn inside a transaction. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
