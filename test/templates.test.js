import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startApp } from './helpers.js';
import { createDocument } from '../shared/blocks.js';
import { openDatabase } from '../server/lib/db.js';

let t, alice, bob, carol, admin, juniorId, seniorId;
const uid = (name) => t.auth.findUser(name).id;

before(async () => {
  t = await startApp();
  admin = await t.userClient('admin', 'admin', 'violet harbour kite 9');
  alice = await t.userClient('alice', 'editor', 'quiet river lamp 7');
  bob = await t.userClient('bobby', 'editor', 'amber field stone 8');
  carol = await t.userClient('carol', 'editor', 'silver meadow fox 3');
  juniorId = (await (await admin.fetch('/api/groups', { method: 'POST', json: { name: 'Junior School' } })).json()).group.id;
  seniorId = (await (await admin.fetch('/api/groups', { method: 'POST', json: { name: 'Senior School' } })).json()).group.id;
  // alice and bobby are in Junior School; carol is in Senior School.
  await admin.fetch(`/api/users/${uid('alice')}/groups`, { method: 'PUT', json: { groupIds: [juniorId] } });
  await admin.fetch(`/api/users/${uid('bobby')}/groups`, { method: 'PUT', json: { groupIds: [juniorId] } });
  await admin.fetch(`/api/users/${uid('carol')}/groups`, { method: 'PUT', json: { groupIds: [seniorId] } });
});
after(() => t?.close());

const create = async (c, name, extra = {}) => {
  const res = await c.fetch('/api/templates', { method: 'POST', json: { name, doc: createDocument('Weekly'), ...extra } });
  return { res, body: await res.json() };
};
const visible = async (c, all = false) => (await (await c.fetch(`/api/templates${all ? '?all=1' : ''}`)).json()).templates.map((x) => x.name).sort();

test('new templates are personal by default and only their owner sees them', async () => {
  const { res, body } = await create(alice, '  Alice   draft ');
  assert.equal(res.status, 201);
  assert.equal(body.template.name, 'Alice draft');
  assert.equal(body.template.scope, 'user');
  assert.equal(body.template.owner, 'alice');
  assert.ok((await visible(alice)).includes('Alice draft'));
  assert.ok(!(await visible(bob)).includes('Alice draft'));
  // Can't be fetched by id either.
  assert.equal((await bob.fetch(`/api/templates/${body.template.id}`)).status, 404);
});

test('group templates are visible to group members only; global to everyone', async () => {
  await create(alice, 'Junior newsletter', { scope: 'group', groupId: juniorId });
  await create(alice, 'Whole-school notice', { scope: 'global' });
  assert.ok((await visible(bob)).includes('Junior newsletter'));
  assert.ok(!(await visible(carol)).includes('Junior newsletter'));
  for (const c of [alice, bob, carol]) assert.ok((await visible(c)).includes('Whole-school notice'));
  const list = (await (await bob.fetch('/api/templates')).json()).templates;
  const jn = list.find((x) => x.name === 'Junior newsletter');
  assert.deepEqual([jn.scope, jn.groupName, jn.owner, jn.canEdit, jn.mine], ['group', 'Junior School', 'alice', false, false]);
});

test('members can only share with their own groups; admins with any', async () => {
  assert.equal((await create(alice, 'Sneaky', { scope: 'group', groupId: seniorId })).res.status, 403);
  assert.equal((await create(alice, 'No group', { scope: 'group' })).res.status, 400);
  assert.equal((await create(alice, 'Bad scope', { scope: 'public' })).res.status, 400);
  assert.equal((await create(admin, 'Senior staff', { scope: 'group', groupId: seniorId })).res.status, 201);
  assert.ok((await visible(carol)).includes('Senior staff'));
});

test('owners can re-share; others cannot edit', async () => {
  const { body } = await create(alice, 'Excursion note');
  const id = body.template.id;
  assert.equal((await bob.fetch(`/api/templates/${id}`, { method: 'PUT', json: { name: 'Hijacked' } })).status, 404); // can't even see it
  const toGroup = await alice.fetch(`/api/templates/${id}`, { method: 'PUT', json: { scope: 'group', groupId: juniorId } });
  assert.equal((await toGroup.json()).template.scope, 'group');
  assert.ok((await visible(bob)).includes('Excursion note'));
  assert.equal((await bob.fetch(`/api/templates/${id}`, { method: 'PUT', json: { name: 'Hijacked' } })).status, 403);
  assert.equal((await alice.fetch(`/api/templates/${id}`, { method: 'PUT', json: { scope: 'user' } })).status, 200);
  assert.ok(!(await visible(bob)).includes('Excursion note'));
});

test('names are unique per owner, not across everyone', async () => {
  assert.equal((await create(bob, 'Weekly')).res.status, 201);
  assert.equal((await create(carol, 'weekly')).res.status, 201); // someone else's "Weekly" is fine
  assert.equal((await create(bob, 'WEEKLY')).res.status, 409);
  assert.equal((await create(bob, '   ')).res.status, 400);
});

test('admins see everything with ?all=1, but the menu list stays personal', async () => {
  const mine = await visible(admin);
  const all = await visible(admin, true);
  assert.ok(!mine.includes('Alice draft'));
  assert.ok(all.includes('Alice draft'));
  assert.deepEqual(await visible(bob, true), await visible(bob)); // ?all is ignored for editors
});

test('user list shows groups and template counts; editors see their own groups', async () => {
  const { users } = await (await admin.fetch('/api/users')).json();
  const a = users.find((u) => u.username === 'alice');
  assert.deepEqual(a.groups.map((g) => g.name), ['Junior School']);
  assert.ok(a.templates.total >= 4);
  const me = (await (await alice.fetch('/api/auth/me')).json()).user;
  assert.deepEqual(me.groups.map((g) => g.name), ['Junior School']);
  assert.equal((await alice.fetch('/api/groups')).status, 403);
  assert.equal((await alice.fetch(`/api/users/${uid('alice')}/groups`, { method: 'PUT', json: { groupIds: [seniorId] } })).status, 403);
});

test('deleting a group turns its templates into personal templates of their owners', async () => {
  const gid = (await (await admin.fetch('/api/groups', { method: 'POST', json: { name: 'Temp' } })).json()).group.id;
  await admin.fetch(`/api/users/${uid('bobby')}/groups`, { method: 'PUT', json: { groupIds: [juniorId, gid] } });
  await create(bob, 'Temp group template', { scope: 'group', groupId: gid });
  assert.equal((await admin.fetch('/api/groups', { method: 'POST', json: { name: 'temp' } })).status, 409);
  assert.equal((await admin.fetch(`/api/groups/${gid}`, { method: 'DELETE' })).status, 200);
  const t2 = (await (await bob.fetch('/api/templates')).json()).templates.find((x) => x.name === 'Temp group template');
  assert.equal(t2.scope, 'user');
  assert.deepEqual((await (await bob.fetch('/api/auth/me')).json()).user.groups.map((g) => g.name), ['Junior School']);
});

test('removed users: shared templates stay, personal ones are kept for admins, and an archive can be downloaded', async () => {
  const dave = await t.userClient('dave', 'editor', 'copper valley moon 4');
  await create(dave, 'Dave personal');
  await create(dave, 'Dave personal');
  await create(dave, 'Dave shared', { scope: 'global' });
  await create(dave, 'Dave / Report: Term 4');
  t.auth.deleteUser(uid('dave'));

  assert.ok((await visible(alice)).includes('Dave shared'));
  assert.ok(!(await visible(alice)).includes('Dave personal'));
  const all = (await (await admin.fetch('/api/templates?all=1')).json()).templates.filter((x) => x.owner === 'dave');
  assert.equal(all.length, 3);
  assert.ok(all.every((x) => x.ownerRemoved && x.canEdit));
  const { removedOwners } = await (await admin.fetch('/api/users')).json();
  assert.deepEqual(removedOwners, [{ username: 'dave', templates: 3 }]);

  assert.equal((await alice.fetch('/api/templates/archive?owner=dave')).status, 403);
  assert.equal((await admin.fetch('/api/templates/archive?owner=nobody')).status, 404);
  const res = await admin.fetch('/api/templates/archive?owner=dave');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="swiftwing-templates-dave-\d{4}-\d{2}-\d{2}\.zip"/);
  const dir = mkdtempSync(path.join(tmpdir(), 'swiftwing-zip-'));
  const file = path.join(dir, 'a.zip');
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  // Read it back with Python's zipfile, which checks CRCs.
  const out = JSON.parse(
    execFileSync('python3', ['-I', '-c', `import zipfile,json,sys
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
print(json.dumps({n: z.read(n).decode() for n in z.namelist()}))`, file], { encoding: 'utf8' }),
  );
  assert.deepEqual(Object.keys(out).sort(), ['Dave-Report-Term-4.json', 'Dave-shared.json', 'Dave-personal.json', 'index.json'].sort());
  const index = JSON.parse(out['index.json']);
  assert.equal(index.owner, 'dave');
  assert.deepEqual(index.templates.map((x) => x.sharing).sort(), ['global', 'personal', 'personal']);
  assert.ok(Array.isArray(JSON.parse(out['Dave-personal.json']).blocks)); // opens with File → Open design
});

test('upgrading an existing database makes old templates global and records their owners', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'swiftwing-mig-'));
  const file = path.join(dir, 'old.db');
  const db = openDatabase(':memory:'); // warm-up: ensure node:sqlite loads quietly
  db.close();
  // Build a version-1 database by hand.
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const v1 = new DatabaseSync(file);
  v1.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at INTEGER NOT NULL, last_login_at INTEGER, password_changed_at INTEGER NOT NULL);
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT, user_agent TEXT);
    CREATE TABLE login_failures (username TEXT PRIMARY KEY COLLATE NOCASE, count INTEGER NOT NULL, last_at INTEGER NOT NULL, locked_until INTEGER);
    CREATE TABLE login_attempts_ip (ip TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL DEFAULT '', doc TEXT NOT NULL, created_by INTEGER, updated_by INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO users VALUES (1, 'tom', 'x', 'admin', 0, NULL, 0);
    INSERT INTO templates VALUES (1, 'Old weekly', '', '{"blocks":[]}', 1, 1, 0, 0);
    PRAGMA user_version = 1;`);
  v1.close();
  const up = openDatabase(file);
  assert.equal(up.prepare('PRAGMA user_version').get().user_version, 2);
  const row = up.prepare('SELECT name, scope, owner_username FROM templates').get();
  assert.deepEqual({ ...row }, { name: 'Old weekly', scope: 'global', owner_username: 'tom' });
  up.close();
});
