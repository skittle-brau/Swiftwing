import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { startApp } from './helpers.js';
import { createDocument, createBlock } from '../shared/blocks.js';

let t, admin, editor;
const put = (rel, bytes = 100) => {
  mkdirSync(path.join(t.dir, path.dirname(rel)), { recursive: true });
  writeFileSync(path.join(t.dir, rel), Buffer.alloc(bytes));
};

before(async () => {
  t = await startApp({ now: () => new Date(2026, 10, 14) }); // 14 Nov 2026
  admin = await t.userClient('admin', 'admin', 'violet harbour kite 9');
  editor = await t.userClient('editor', 'editor', 'amber field stone 8');
  put('2026/11/Spring-Gala/a.jpg', 1000);
  put('2026/11/Spring-Gala/b.png', 500);
  put('2026/11/Newsletter/c.jpg', 200);
  put('2026/10/Newsletter/d.jpg', 300);
  put('2024/10/Old-Project/e.jpg', 50);
  put('2024/10/Old-Project/notes.txt', 10); // not an image: ignored by the tree
});
after(() => t?.close());

test('tree groups uploads by year → month → project with counts, sizes and age', async () => {
  const { years } = await (await editor.fetch('/api/uploads/tree')).json();
  assert.deepEqual(years.map((y) => y.year), ['2026', '2024']);
  const y26 = years[0];
  assert.equal(y26.files, 4);
  assert.equal(y26.bytes, 2000);
  assert.deepEqual(y26.months.map((m) => m.month), ['11', '10']);
  const nov = y26.months[0];
  assert.equal(nov.path, '2026/11');
  assert.equal(nov.ageMonths, 0);
  assert.deepEqual(nov.projects.map((p) => [p.name, p.files, p.bytes]), [['Newsletter', 1, 200], ['Spring-Gala', 2, 1500]]);
  assert.equal(years[1].months[0].ageMonths, 25); // October 2024: over two years old
  assert.equal(years[1].files, 1);
});

test('lists one project folder', async () => {
  const { files } = await (await editor.fetch('/api/uploads?folder=2026/11/Spring-Gala')).json();
  assert.deepEqual(files.map((f) => f.name).sort(), ['a.jpg', 'b.png']);
  const bad = await (await editor.fetch('/api/uploads?folder=../../etc')).json();
  assert.deepEqual(bad.files, []);
});

test('folder summary counts files and lists templates that use the images', async () => {
  const doc = createDocument('Gala');
  doc.blocks = [createBlock('image', { src: '/uploads/2026/11/Spring-Gala/a.jpg', alt: 'x' })];
  await admin.fetch('/api/templates', { method: 'POST', json: { name: 'Gala invite', doc } });
  const s = await (await editor.fetch('/api/uploads/folder?path=2026/11')).json();
  assert.equal(s.files, 3);
  assert.equal(s.bytes, 1700);
  assert.deepEqual(s.projects, ['2026/11/Newsletter', '2026/11/Spring-Gala']);
  assert.deepEqual(s.templates, ['Gala invite']);
  const other = await (await editor.fetch('/api/uploads/folder?path=2026/10')).json();
  assert.deepEqual(other.templates, []);
  assert.equal((await editor.fetch('/api/uploads/folder?path=2026/12')).status, 404);
  assert.equal((await editor.fetch('/api/uploads/folder?path=2026/11/..')).status, 400);
});

test('only admins can purge folders, and only with a matching confirmation', async () => {
  const del = (c, p, confirm = p) => c.fetch(`/api/uploads/folder?path=${encodeURIComponent(p)}&confirm=${encodeURIComponent(confirm)}`, { method: 'DELETE' });
  assert.equal((await del(editor, '2026/10')).status, 403);
  assert.equal((await del(admin, '2026/10', '2026/11')).status, 400);
  assert.equal((await del(admin, '../uploads')).status, 400);
  assert.ok(existsSync(path.join(t.dir, '2026/10/Newsletter/d.jpg')));

  // Project level: the now-empty month and year folders are tidied away only when empty.
  const res = await del(admin, '2026/11/Spring-Gala');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).deleted.files, 2);
  assert.ok(!existsSync(path.join(t.dir, '2026/11/Spring-Gala')));
  assert.ok(existsSync(path.join(t.dir, '2026/11/Newsletter/c.jpg')));

  // Month level.
  assert.equal((await del(admin, '2026/10')).status, 200);
  assert.ok(!existsSync(path.join(t.dir, '2026/10')));
  assert.ok(existsSync(path.join(t.dir, '2026/11')));

  // Year level removes everything under it, including non-image files.
  assert.equal((await del(admin, '2024')).status, 200);
  assert.ok(!existsSync(path.join(t.dir, '2024')));
  assert.equal((await del(admin, '2024')).status, 404);

  // Deleting the last project in a month and year removes the empty parents.
  assert.equal((await del(admin, '2026/11/Newsletter')).status, 200);
  assert.ok(!existsSync(path.join(t.dir, '2026')));
  const { years } = await (await admin.fetch('/api/uploads/tree')).json();
  assert.deepEqual(years, []);
});
