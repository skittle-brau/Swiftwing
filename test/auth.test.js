import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../server/lib/auth.js';

let t;
let clock = Date.now();
const MIN = 60_000;
before(async () => {
  t = await startApp({ auth: { now: () => clock, ipLimit: 12, log: () => {} } });
  await t.auth.createUser('admin', 'tidy lantern orbit 42', 'admin');
  await t.auth.createUser('jo', 'jo password 12345', 'editor');
});
after(() => t?.close());

test('pages and API require login; uploads, health and the login page stay public', async () => {
  const anon = t.client();
  const home = await anon.fetch('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/login');
  assert.equal((await anon.fetch('/index.html')).status, 302);
  assert.equal((await anon.fetch('/api/uploads')).status, 401);
  assert.equal((await anon.fetch('/api/templates')).status, 401);
  assert.equal((await anon.fetch('/api/health')).status, 200);
  assert.equal((await anon.fetch('/login')).status, 200);
  assert.equal((await anon.fetch('/uploads/2026/11/x/missing.png')).status, 404); // not 401/302
  const status = await (await anon.fetch('/api/auth/status')).json();
  assert.deepEqual(status, { hasUsers: true, user: null });
});

test('successful login sets a hardened session cookie', async () => {
  const c = t.client();
  const res = await c.login('JO', 'jo password 12345'); // usernames are case-insensitive
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^swiftwing_session=[\w-]{43};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const me = await (await c.fetch('/api/auth/me')).json();
  assert.equal(me.user.username, 'jo');
  assert.equal((await c.fetch('/')).status, 200);
});

test('Secure cookie flag is set when Caddy forwards an HTTPS request', async () => {
  const c = t.client();
  const res = await c.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'x-forwarded-proto': 'https' },
    json: { username: 'jo', password: 'jo password 12345' },
  });
  assert.match(res.headers.get('set-cookie'), /; Secure/);
});

test('5 wrong passwords lock the account for 15 minutes', async () => {
  await t.auth.createUser('sam', 'sam password 12345');
  const c = t.client();
  const msgs = [];
  for (let i = 0; i < 4; i++) {
    const r = await c.login('sam', 'wrong password!!');
    assert.equal(r.status, 401);
    msgs.push((await r.json()).error);
  }
  assert.equal(msgs[0], 'Incorrect username or password.');
  assert.match(msgs[3], /1 attempt left before the account is locked for 15 minutes/);

  const fifth = await c.login('sam', 'wrong password!!');
  assert.equal(fifth.status, 429);
  assert.equal(fifth.headers.get('retry-after'), '900');
  assert.match((await fifth.json()).error, /locked for 15 minutes/);

  // Even the right password is refused while locked.
  const locked = await c.login('sam', 'sam password 12345');
  assert.equal(locked.status, 429);

  clock += 16 * MIN;
  const ok = await c.login('sam', 'sam password 12345');
  assert.equal(ok.status, 200);
});

test('unknown usernames lock the same way, so lockouts do not reveal accounts', async () => {
  const c = t.client();
  for (let i = 0; i < 4; i++) assert.equal((await c.login('nobody', 'whatever password')).status, 401);
  const r = await c.login('nobody', 'whatever password');
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /This account is locked for 15 minutes/);
  clock += 16 * MIN;
});

test('admins can unlock an account early', async () => {
  const c = t.client();
  for (let i = 0; i < 5; i++) await c.login('jo', 'not the password');
  assert.equal((await c.login('jo', 'jo password 12345')).status, 429);
  const admin = await t.userClient('admin', 'admin', 'tidy lantern orbit 42');
  const list = await (await admin.fetch('/api/users')).json();
  const jo = list.users.find((u) => u.username === 'jo');
  assert.ok(jo.lockedUntil);
  assert.equal((await admin.fetch(`/api/users/${jo.id}`, { method: 'PATCH', json: { unlock: true } })).status, 200);
  assert.equal((await c.login('jo', 'jo password 12345')).status, 200);
});

test('too many failures from one IP are throttled across usernames', async () => {
  clock += 60 * MIN;
  const c = t.client();
  let last;
  for (let i = 0; i < 13; i++) last = await c.login(`spray${i}`, 'Winter2026!!!');
  assert.equal(last.status, 429);
  assert.match((await last.json()).error, /Too many failed logins from your network/);
  clock += 16 * MIN;
});

test('state-changing requests from other sites are rejected', async () => {
  const c = await t.userClient('jo', 'editor', 'jo password 12345');
  const evil = await c.fetch('/api/templates', { method: 'POST', headers: { origin: 'https://evil.example' }, json: { name: 'x', doc: { blocks: [] } } });
  assert.equal(evil.status, 403);
  const none = await fetch(`${t.base}/api/auth/logout`, { method: 'POST', headers: { cookie: c.cookie } });
  assert.equal(none.status, 403);
  // The configured public address counts as same-site (Caddy keeps the Host header).
  const viaProxy = await c.fetch('/api/templates', { method: 'POST', headers: { origin: 'https://mail.example.org' }, json: { name: 'Proxy ok', doc: { blocks: [] } } });
  assert.equal(viaProxy.status, 201);
});

test('logout ends the session', async () => {
  const c = await t.userClient('jo', 'editor', 'jo password 12345');
  const old = c.cookie;
  await c.fetch('/api/auth/logout', { method: 'POST' });
  const res = await fetch(`${t.base}/api/auth/me`, { headers: { cookie: old } });
  assert.equal(res.status, 401);
});

test('sessions expire after 7 idle days', async () => {
  const c = await t.userClient('jo', 'editor', 'jo password 12345');
  clock += 6 * 24 * 60 * MIN;
  assert.equal((await c.fetch('/api/auth/me')).status, 200); // activity slides the window
  clock += 6 * 24 * 60 * MIN;
  assert.equal((await c.fetch('/api/auth/me')).status, 200);
  clock += 8 * 24 * 60 * MIN;
  assert.equal((await c.fetch('/api/auth/me')).status, 401);
});

test('changing your password signs out your other sessions', async () => {
  const a = await t.userClient('jo', 'editor', 'jo password 12345');
  const b = await t.userClient('jo', 'editor', 'jo password 12345');
  const bad = await a.fetch('/api/auth/password', { method: 'POST', json: { currentPassword: 'nope', newPassword: 'a brand new password' } });
  assert.equal(bad.status, 403);
  const weak = await a.fetch('/api/auth/password', { method: 'POST', json: { currentPassword: 'jo password 12345', newPassword: 'short' } });
  assert.equal(weak.status, 400);
  const ok = await a.fetch('/api/auth/password', { method: 'POST', json: { currentPassword: 'jo password 12345', newPassword: 'a brand new password' } });
  assert.equal(ok.status, 200);
  assert.equal((await a.fetch('/api/auth/me')).status, 200);
  assert.equal((await b.fetch('/api/auth/me')).status, 401);
  await t.auth.setPassword(t.auth.findUser('jo').id, 'jo password 12345');
});

test('only admins manage users, and the last admin is protected', async () => {
  const editor = await t.userClient('jo', 'editor', 'jo password 12345');
  assert.equal((await editor.fetch('/api/users')).status, 403);
  assert.equal((await editor.fetch('/api/users', { method: 'POST', json: { username: 'x1', password: 'long enough pass' } })).status, 403);

  const admin = await t.userClient('admin', 'admin', 'tidy lantern orbit 42');
  const created = await admin.fetch('/api/users', { method: 'POST', json: { username: 'new.user', password: 'new user password', role: 'editor' } });
  assert.equal(created.status, 201);
  const { user } = await created.json();
  assert.equal((await admin.fetch('/api/users', { method: 'POST', json: { username: 'New.User', password: 'another password' } })).status, 409);
  assert.equal((await admin.fetch('/api/users', { method: 'POST', json: { username: 'shorty', password: 'short' } })).status, 400);

  const me = t.auth.findUser('admin');
  assert.equal((await admin.fetch(`/api/users/${me.id}`, { method: 'DELETE' })).status, 409);
  assert.equal((await admin.fetch(`/api/users/${me.id}`, { method: 'PATCH', json: { role: 'editor' } })).status, 409);
  assert.equal((await admin.fetch(`/api/users/${user.id}`, { method: 'DELETE' })).status, 200);
});

test('password policy and hashing', async () => {
  assert.match(checkPasswordPolicy('short'), /at least 12/);
  assert.match(checkPasswordPolicy('password1234'), /too common/);
  assert.match(checkPasswordPolicy('samwise-is-my-name', 'samwise'), /must not contain the username/);
  assert.equal(checkPasswordPolicy('correct horse battery staple'), null);
  const h = await hashPassword('correct horse battery staple');
  assert.match(h, /^scrypt\$32768\$8\$3\$/);
  assert.equal(await verifyPassword('correct horse battery staple', h), true);
  assert.equal(await verifyPassword('Correct horse battery staple', h), false);
});
