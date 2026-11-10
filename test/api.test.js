import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startApp } from './helpers.js';
import sharp from 'sharp';
import { createDocument } from '../shared/blocks.js';

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let t, api, dir;
before(async () => {
  t = await startApp({ now: () => new Date(2026, 10, 3) });
  dir = t.dir;
  api = await t.userClient('tester');
});
after(() => t?.close());

async function upload(name, type, project = 'Spring Gala', body = PNG) {
  const fd = new FormData();
  fd.append('files', new Blob([body], { type }), name);
  return api.fetch(`/api/uploads?project=${encodeURIComponent(project)}`, { method: 'POST', body: fd });
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

  const img = await fetch(t.base + body.files[0].url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
});

test('rejects non-image uploads', async () => {
  const res = await upload('evil.html', 'text/html');
  assert.equal(res.status, 415);
});

test('rejects a non-image disguised with an image MIME type', async () => {
  const res = await upload('evil.png', 'image/png', 'Spring Gala', Buffer.from('<?php echo 1; ?>'));
  assert.equal(res.status, 415);
  assert.match((await res.json()).error, /evil\.png: The file is not a readable image/);
});

test('downscales large photos to 1200px and converts WebP for Outlook', async () => {
  const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#336699' } }).webp().toBuffer();
  const res = await upload('Big Photo.webp', 'image/webp', 'Spring Gala', photo);
  assert.equal(res.status, 201);
  const { files, maxWidth } = await res.json();
  assert.equal(maxWidth, 1200);
  const [f] = files;
  assert.equal(f.name, 'big-photo.jpg');
  assert.equal(f.width, 1200);
  assert.equal(f.height, 900);
  assert.deepEqual(
    { resized: f.optimized.resized, converted: f.optimized.converted, from: f.optimized.originalWidth },
    { resized: true, converted: true, from: 4000 },
  );
  const stored = await sharp(path.join(dir, f.path)).metadata();
  assert.equal(stored.format, 'jpeg');
  assert.equal(stored.width, 1200);
});

test('lists and deletes uploads per project', async () => {
  await upload('other.png', 'image/png', 'Other Project');
  const list = await (await api.fetch('/api/uploads?project=Spring%20Gala')).json();
  assert.ok(list.files.length >= 2);
  assert.ok(list.files.every((f) => f.project === 'Spring-Gala'));

  const bad = await api.fetch(`/api/uploads?path=${encodeURIComponent('../../etc/passwd')}`, { method: 'DELETE' });
  assert.equal(bad.status, 400);

  const del = await api.fetch(`/api/uploads?path=${encodeURIComponent('2026/11/Other-Project/other.png')}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
});

test('export endpoint returns inlined XHTML with absolute image URLs', async () => {
  const doc = createDocument('Spring Gala');
  doc.blocks.unshift({ id: 'img1', type: 'image', props: { src: '/uploads/2026/11/Spring-Gala/hero-image.png', alt: 'Hero' } });
  const res = await api.fetch('/api/export', { method: 'POST', json: { doc } });
  assert.equal(res.status, 200);
  const { html, bytes, warnings } = await res.json();
  assert.ok(html.startsWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"'));
  assert.match(html, /src="https:\/\/mail\.example\.org\/uploads\/2026\/11\/Spring-Gala\/hero-image\.png"/);
  assert.ok(bytes > 0);
  assert.ok(Array.isArray(warnings));

  const dl = await api.fetch('/api/export?download&filename=news.html', { method: 'POST', json: { doc } });
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="news.html"/);
});

test('export validates its input', async () => {
  const res = await api.fetch('/api/export', { method: 'POST', json: {} });
  assert.equal(res.status, 400);
});
