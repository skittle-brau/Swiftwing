import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';
import { createDocument } from '../shared/blocks.js';

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let server, base, dir;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'atelier-up-'));
  const app = createApp({ uploadDir: dir, publicBaseUrl: 'https://mail.example.org', now: () => new Date(2026, 10, 3) });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function upload(name, type, project = 'Spring Gala') {
  const fd = new FormData();
  fd.append('files', new Blob([PNG], { type }), name);
  return fetch(`${base}/api/uploads?project=${encodeURIComponent(project)}`, { method: 'POST', body: fd });
}

test('uploads land in YYYY/MM/ProjectName and are served back', async () => {
  const res = await upload('Hero Image.png', 'image/png');
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.directory, '2026/11/Spring-Gala');
  assert.equal(body.files[0].url, '/uploads/2026/11/Spring-Gala/hero-image.png');
  assert.ok(existsSync(path.join(dir, '2026/11/Spring-Gala/hero-image.png')));

  const again = await (await upload('Hero Image.png', 'image/png')).json();
  assert.equal(again.files[0].name, 'hero-image-1.png', 'duplicate names are de-duplicated');

  const img = await fetch(base + body.files[0].url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
});

test('rejects non-image uploads', async () => {
  const res = await upload('evil.html', 'text/html');
  assert.equal(res.status, 415);
});

test('lists and deletes uploads per project', async () => {
  await upload('other.png', 'image/png', 'Other Project');
  const list = await (await fetch(`${base}/api/uploads?project=Spring%20Gala`)).json();
  assert.ok(list.files.length >= 2);
  assert.ok(list.files.every((f) => f.project === 'Spring-Gala'));

  const bad = await fetch(`${base}/api/uploads?path=${encodeURIComponent('../../etc/passwd')}`, { method: 'DELETE' });
  assert.equal(bad.status, 400);

  const del = await fetch(`${base}/api/uploads?path=${encodeURIComponent('2026/11/Other-Project/other.png')}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

test('export endpoint returns inlined XHTML with absolute image URLs', async () => {
  const doc = createDocument('Spring Gala');
  doc.blocks.unshift({ id: 'img1', type: 'image', props: { src: '/uploads/2026/11/Spring-Gala/hero-image.png', alt: 'Hero' } });
  const res = await fetch(`${base}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc }),
  });
  assert.equal(res.status, 200);
  const { html, bytes, warnings } = await res.json();
  assert.ok(html.startsWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"'));
  assert.match(html, /src="https:\/\/mail\.example\.org\/uploads\/2026\/11\/Spring-Gala\/hero-image\.png"/);
  assert.ok(bytes > 0);
  assert.ok(Array.isArray(warnings));

  const dl = await fetch(`${base}/api/export?download&filename=news.html`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc }),
  });
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="news.html"/);
});

test('export validates its input', async () => {
  const res = await fetch(`${base}/api/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 400);
});
