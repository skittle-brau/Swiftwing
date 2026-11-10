/**
 * Accounts, password checking, login throttling and sessions.
 *
 * Design (OWASP / NIST SP 800-63B aligned):
 *  - Passwords hashed with scrypt (memory-hard, built into Node), random salt.
 *  - Length-based password policy (min 12, no composition rules), common
 *    passwords rejected.
 *  - 5 consecutive failures for a username lock it for 15 minutes. Failures
 *    are tracked for any username, existing or not, so lockouts don't reveal
 *    which accounts exist. Unknown usernames still pay the scrypt cost.
 *  - Per-IP limit on failed attempts stops password spraying across accounts.
 *  - Server-side sessions: a random 256-bit token in an HttpOnly cookie; only
 *    its SHA-256 is stored, so a leaked database can't be replayed. Sessions
 *    expire after 7 idle days or 30 days in total, and changing a password
 *    signs out every other session.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { transaction } from './db.js';

const scrypt = promisify(crypto.scrypt);

// OWASP-listed scrypt parameters (N=2^15, r=8, p=3): ~32 MiB per hash.
const SCRYPT = { N: 2 ** 15, r: 8, p: 3, keylen: 32 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;
const USERNAME_RE = /^[a-z0-9][a-z0-9._@-]{1,63}$/i;

const COMMON_PASSWORDS = new Set([
  'password1234', 'password12345', 'password123456', '123456789012', '1234567890123',
  'qwertyuiop12', 'qwerty123456', 'letmein12345', 'welcome12345', 'iloveyou1234',
  'administrator', 'changeme1234', 'passw0rd1234', 'abcdefghijkl', 'abc123456789',
  '111111111111', '000000000000', 'aaaaaaaaaaaa', 'princess1234', 'football1234',
]);

export class AuthError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { ...SCRYPT, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM,
  });
  return crypto.timingSafeEqual(key, expected);
}

function needsRehash(stored) {
  const [, N, r, p] = String(stored).split('$');
  return Number(N) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p;
}

/** Returns an error message, or null when the password is acceptable. */
export function checkPasswordPolicy(password, username = '') {
  const pw = String(password ?? '');
  const length = [...pw].length;
  if (length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  const lower = pw.toLowerCase();
  const user = String(username || '').toLowerCase();
  // Substring check only for usernames long enough not to match ordinary words.
  if (user && (lower === user || (user.length >= 4 && lower.includes(user)))) return 'Password must not contain the username.';
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(pw)) return 'That password is too common. Choose another.';
  return null;
}

export function checkUsername(username) {
  if (!USERNAME_RE.test(String(username ?? ''))) {
    return 'Username must be 2–64 characters: letters, numbers and . _ @ - (starting with a letter or number).';
  }
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export class AuthService {
  /**
   * @param {import('node:sqlite').DatabaseSync} db
   * @param {object} [opts]
   */
  constructor(db, opts = {}) {
    this.db = db;
    this.now = opts.now || (() => Date.now());
    this.lockThreshold = opts.lockThreshold ?? 5;
    this.lockMs = (opts.lockMinutes ?? 15) * MIN;
    this.failureResetMs = 24 * 60 * MIN; // forget stray failures after a day
    this.ipLimit = opts.ipLimit ?? 30;
    this.ipWindowMs = (opts.ipWindowMinutes ?? 15) * MIN;
    this.idleMs = (opts.sessionIdleDays ?? 7) * DAY;
    this.maxMs = (opts.sessionMaxDays ?? 30) * DAY;
    this.log = opts.log ?? ((msg) => console.warn(`[auth] ${msg}`));
    this.dummyHash = null;
  }

  /* -------------------------------------------------------------- users */

  hasUsers() {
    return !!this.db.prepare('SELECT 1 FROM users LIMIT 1').get();
  }

  listUsers() {
    const now = this.now();
    return this.db
      .prepare(
        `SELECT u.id, u.username, u.role, u.created_at, u.last_login_at, f.locked_until
         FROM users u LEFT JOIN login_failures f ON f.username = u.username
         ORDER BY u.username COLLATE NOCASE`,
      )
      .all()
      .map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.created_at,
        lastLoginAt: u.last_login_at,
        lockedUntil: u.locked_until && u.locked_until > now ? u.locked_until : null,
      }));
  }

  getUser(id) {
    const u = this.db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
    return u ? { id: u.id, username: u.username, role: u.role } : null;
  }

  findUser(username) {
    const u = this.db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(String(username));
    return u ? { id: u.id, username: u.username, role: u.role } : null;
  }

  async createUser(username, password, role = 'editor') {
    const name = String(username ?? '').trim();
    const err = checkUsername(name) || checkPasswordPolicy(password, name);
    if (err) throw new AuthError(err);
    if (!['admin', 'editor'].includes(role)) throw new AuthError('Role must be admin or editor.');
    if (this.findUser(name)) throw new AuthError('That username is already taken.', 409);
    const hash = await hashPassword(password);
    const now = this.now();
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO users (username, password_hash, role, created_at, password_changed_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, hash, role, now, now);
    return this.getUser(Number(lastInsertRowid));
  }

  async setPassword(userId, password, { keepSessionHash = null } = {}) {
    const user = this.getUser(userId);
    if (!user) throw new AuthError('User not found.', 404);
    const err = checkPasswordPolicy(password, user.username);
    if (err) throw new AuthError(err);
    const hash = await hashPassword(password);
    transaction(this.db, () => {
      this.db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(hash, this.now(), userId);
      if (keepSessionHash) this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(userId, keepSessionHash);
      else this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    });
    this.unlock(user.username);
  }

  async changeOwnPassword(userId, current, next, sessionHash) {
    const row = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    if (!row || !(await verifyPassword(current, row.password_hash))) throw new AuthError('Current password is incorrect.', 403);
    await this.setPassword(userId, next, { keepSessionHash: sessionHash });
  }

  adminCount() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  }

  setRole(userId, role) {
    if (!['admin', 'editor'].includes(role)) throw new AuthError('Role must be admin or editor.');
    const user = this.getUser(userId);
    if (!user) throw new AuthError('User not found.', 404);
    if (user.role === 'admin' && role !== 'admin' && this.adminCount() <= 1) {
      throw new AuthError('There must be at least one admin.', 409);
    }
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  }

  deleteUser(userId) {
    const user = this.getUser(userId);
    if (!user) throw new AuthError('User not found.', 404);
    if (user.role === 'admin' && this.adminCount() <= 1) throw new AuthError('You cannot remove the last admin.', 409);
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  unlock(username) {
    this.db.prepare('DELETE FROM login_failures WHERE username = ?').run(String(username));
  }

  /* -------------------------------------------------------------- login */

  async login(username, password, { ip = '', userAgent = '' } = {}) {
    const name = String(username ?? '').trim().slice(0, 64);
    const now = this.now();

    // Per-IP throttle on failed attempts (password spraying).
    this.db.prepare('DELETE FROM login_attempts_ip WHERE at < ?').run(now - this.ipWindowMs);
    const ipRow = this.db.prepare('SELECT COUNT(*) AS n, MIN(at) AS first FROM login_attempts_ip WHERE ip = ?').get(ip);
    if (ipRow.n >= this.ipLimit) {
      const retryMs = ipRow.first + this.ipWindowMs - now;
      throw new AuthError(`Too many failed logins from your network. Try again in ${minutes(retryMs)}.`, 429, { retryAfter: Math.ceil(retryMs / 1000) });
    }

    // Per-username lockout.
    let failure = this.db.prepare('SELECT count, last_at, locked_until FROM login_failures WHERE username = ?').get(name);
    if (failure?.locked_until && failure.locked_until > now) {
      const retryMs = failure.locked_until - now;
      throw new AuthError(`Too many incorrect attempts. This account is locked for ${minutes(retryMs)}.`, 429, { retryAfter: Math.ceil(retryMs / 1000), locked: true });
    }
    if (failure && (failure.locked_until || now - failure.last_at > this.failureResetMs)) {
      // The lock has expired, or the old failures are stale: start counting again.
      this.unlock(name);
      failure = null;
    }

    const row = name ? this.db.prepare('SELECT id, username, role, password_hash FROM users WHERE username = ?').get(name) : null;
    // Always run scrypt so response time doesn't reveal whether the username exists.
    this.dummyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
    const ok = await verifyPassword(String(password ?? ''), row ? row.password_hash : this.dummyHash);

    if (!row || !ok) {
      const count = (failure?.count ?? 0) + 1;
      const lockedUntil = count >= this.lockThreshold ? now + this.lockMs : null;
      this.db
        .prepare(
          `INSERT INTO login_failures (username, count, last_at, locked_until) VALUES (?, ?, ?, ?)
           ON CONFLICT(username) DO UPDATE SET count = excluded.count, last_at = excluded.last_at, locked_until = excluded.locked_until`,
        )
        .run(name, count, now, lockedUntil);
      this.db.prepare('INSERT INTO login_attempts_ip (ip, at) VALUES (?, ?)').run(ip, now);
      if (lockedUntil) {
        this.log(`username "${name}" locked for ${minutes(this.lockMs)} after ${count} failed attempts (last from ${ip || 'unknown'})`);
        throw new AuthError(`Too many incorrect attempts. This account is locked for ${minutes(this.lockMs)}.`, 429, { retryAfter: Math.ceil(this.lockMs / 1000), locked: true });
      }
      const left = this.lockThreshold - count;
      const hint = left <= 2 ? ` ${left} attempt${left === 1 ? '' : 's'} left before the account is locked for ${minutes(this.lockMs)}.` : '';
      throw new AuthError(`Incorrect username or password.${hint}`, 401);
    }

    this.unlock(name);
    if (needsRehash(row.password_hash)) {
      this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(String(password)), row.id);
    }
    this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);
    const token = this.createSession(row.id, { ip, userAgent });
    return { token, user: { id: row.id, username: row.username, role: row.role } };
  }

  /* ----------------------------------------------------------- sessions */

  createSession(userId, { ip = '', userAgent = '' } = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = this.now();
    this.db
      .prepare('INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sha256(token), userId, now, now, now + this.maxMs, ip, String(userAgent).slice(0, 255));
    // Opportunistic cleanup of expired sessions.
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?').run(now, now - this.idleMs);
    return token;
  }

  /** Resolve a session token to { user, sessionHash }, sliding its idle timeout. */
  getSession(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const hash = sha256(token);
    const now = this.now();
    const s = this.db
      .prepare(
        `SELECT s.user_id, s.last_seen_at, s.expires_at, u.username, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
      )
      .get(hash);
    if (!s) return null;
    if (s.expires_at <= now || s.last_seen_at + this.idleMs <= now) {
      this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(hash);
      return null;
    }
    if (now - s.last_seen_at > MIN) this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?').run(now, hash);
    return { user: { id: s.user_id, username: s.username, role: s.role }, sessionHash: hash, expiresAt: s.expires_at };
  }

  logout(token) {
    if (token) this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(sha256(String(token)));
  }

  get sessionMaxSeconds() {
    return Math.floor(this.maxMs / 1000);
  }
}

function minutes(ms) {
  const m = Math.max(1, Math.ceil(ms / MIN));
  return `${m} minute${m === 1 ? '' : 's'}`;
}
