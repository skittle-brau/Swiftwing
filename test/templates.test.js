import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { createDocument } from '../shared/blocks.js';

let t, alice, bob, admin;
before(async () => {
  t = await startApp();
  alice = await t.userClient('alice', 'editor', 'quiet river lamp 7');
  bob = await t.userClient('bobby', 'editor', 'amber field stone 8');
  admin = await t.userClient('admin', 'admin', 'violet harbour kite 9');
});
after(() => t?.close());

const create = (c, name, extra = {}) => c.fetch('/api/templates', { method: 'POST', json: { name, doc: createDocument('Weekly'), ...extra } });

test('create, list and load a shared template', async () => {
  const res = await create(alice, '  Weekly   Newsletter ', { description: 'Every Friday' });
  assert.equal(res.status, 201);
  const { template } = await res.json();
  assert.equal(template.name, 'Weekly Newsletter');
  assert.equal(template.doc.blocks.length, 7);

  const list = await (await bob.fetch('/api/templates')).json();
  const item = list.templates.find((x) => x.id === template.id);
  assert.equal(item.createdBy, 'alice');
  assert.equal(item.canEdit, false);

  const got = await (await bob.fetch(`/api/templates/${template.id}`)).json();
  assert.equal(got.template.doc.settings.projectName, 'Weekly');
});

test('names must be unique (case-insensitive) and non-empty', async () => {
  assert.equal((await create(bob, 'weekly newsletter')).status, 409);
  assert.equal((await create(bob, '   ')).status, 400);
  assert.equal((await bob.fetch('/api/templates', { method: 'POST', json: { name: 'No doc' } })).status, 400);
});

test('only the creator or an admin can update or delete', async () => {
  const { template } = await (await create(alice, 'Excursion note')).json();
  assert.equal((await bob.fetch(`/api/templates/${template.id}`, { method: 'PUT', json: { name: 'Hijacked' } })).status, 403);
  assert.equal((await bob.fetch(`/api/templates/${template.id}`, { method: 'DELETE' })).status, 403);

  const doc = createDocument('Weekly');
  doc.blocks = doc.blocks.slice(0, 2);
  const upd = await alice.fetch(`/api/templates/${template.id}`, { method: 'PUT', json: { doc, description: 'Updated' } });
  assert.equal(upd.status, 200);
  assert.equal((await upd.json()).template.doc.blocks.length, 2);

  assert.equal((await admin.fetch(`/api/templates/${template.id}`, { method: 'PUT', json: { name: 'Excursion permission note' } })).status, 200);
  assert.equal((await admin.fetch(`/api/templates/${template.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await alice.fetch(`/api/templates/${template.id}`)).status, 404);
});

test('templates survive the creator being removed', async () => {
  const carol = await t.userClient('carol', 'editor', 'silver meadow fox 3');
  const { template } = await (await create(carol, 'Carol template')).json();
  t.auth.deleteUser(t.auth.findUser('carol').id);
  const list = await (await alice.fetch('/api/templates')).json();
  const item = list.templates.find((x) => x.id === template.id);
  assert.equal(item.createdBy, null);
  assert.equal(item.canEdit, false);
  assert.equal((await admin.fetch(`/api/templates/${template.id}`, { method: 'DELETE' })).status, 200);
});
