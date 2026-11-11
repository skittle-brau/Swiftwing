#!/usr/bin/env node
/**
 * Account management from the server's command line.
 *
 *   node server/cli.js user add <username> [--admin]
 *   node server/cli.js user passwd <username>
 *   node server/cli.js user role <username> admin|editor
 *   node server/cli.js user unlock <username>
 *   node server/cli.js user remove <username>
 *   node server/cli.js user list
 *
 * Passwords are typed at a hidden prompt, or read from stdin when piped
 * (echo 'pw' | node server/cli.js user add jo). The database location comes
 * from DB_PATH / UPLOAD_DIR like the server (on the LXC, use the
 * `atelier-user` wrapper the install script creates).
 */
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { openDatabase, defaultDbPath } from './lib/db.js';
import { AuthService, AuthError } from './lib/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage(code = 1) {
  console.log(`Usage:
  user add <username> [--admin]     create an account (prompts for a password)
  user passwd <username>            set a new password (signs the user out everywhere)
  user role <username> admin|editor change role
  user unlock <username>            clear a login lockout
  user remove <username>            delete an account
  user list                         show accounts`);
  process.exit(code);
}

async function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0];
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(prompt)) process.stdout.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function newPassword() {
  const pw = await readSecret('New password: ');
  if (process.stdin.isTTY) {
    const again = await readSecret('Repeat password: ');
    if (again !== pw) throw new AuthError('Passwords did not match.');
  }
  return pw;
}

/** When run as root, hand the database back to whoever owns its folder (the service user). */
function fixOwnership(file) {
  if (file === ':memory:' || typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const { uid, gid } = fs.statSync(path.dirname(file));
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    if (fs.existsSync(f)) fs.chownSync(f, uid, gid);
  }
}

const fmt = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : 'never');

async function main() {
  const [scope, cmd, name, arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
  if (scope !== 'user' || !cmd) usage();

  const file = defaultDbPath(ROOT);
  const db = openDatabase(file);
  const auth = new AuthService(db, { log: () => {} });
  const need = () => {
    const u = auth.findUser(name);
    if (!u) throw new AuthError(`No user called "${name}".`);
    return u;
  };

  try {
    switch (cmd) {
      case 'add': {
        if (!name) usage();
        const role = flags.has('--admin') ? 'admin' : 'editor';
        const u = await auth.createUser(name, await newPassword(), role);
        console.log(`Created ${u.role} "${u.username}".`);
        break;
      }
      case 'passwd':
        await auth.setPassword(need().id, await newPassword());
        console.log(`Password changed for "${name}". Their existing sessions were signed out.`);
        break;
      case 'role':
        auth.setRole(need().id, arg);
        console.log(`"${name}" is now ${arg}.`);
        break;
      case 'unlock':
        auth.unlock(name);
        console.log(`Cleared any lockout for "${name}".`);
        break;
      case 'remove':
        auth.deleteUser(need().id);
        console.log(`Removed "${name}".`);
        break;
      case 'list': {
        const users = auth.listUsers();
        if (!users.length) console.log('No accounts yet. Create one with: user add <username> --admin');
        for (const u of users) {
          console.log(`${u.username.padEnd(24)} ${u.role.padEnd(7)} last login ${fmt(u.lastLoginAt)}${u.lockedUntil ? `  LOCKED until ${fmt(u.lockedUntil)}` : ''}`);
        }
        break;
      }
      default:
        usage();
    }
  } finally {
    db.close();
    fixOwnership(file);
  }
}

main().catch((err) => {
  console.error(err instanceof AuthError ? err.message : err);
  process.exit(1);
});
