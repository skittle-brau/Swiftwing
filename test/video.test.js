import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import sharp from 'sharp';
import { startApp } from './helpers.js';
import { parseVideoUrl } from '../server/lib/video.js';
import { exportEmail } from '../server/lib/exporter.js';
import { createDocument, createBlock } from '../shared/blocks.js';

test('recognises YouTube and Vimeo link formats', () => {
  const yt = (u) => parseVideoUrl(u)?.url;
  assert.equal(yt('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(yt('https://youtu.be/dQw4w9WgXcQ?t=42'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
  assert.equal(yt('youtube.com/shorts/dQw4w9WgXcQ'), 'https://www.youtube.com/shorts/dQw4w9WgXcQ');
  assert.equal(yt('https://m.youtube.com/embed/dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(yt('https://www.youtube.com/live/dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(yt('https://vimeo.com/76979871'), 'https://vimeo.com/76979871');
  assert.equal(yt('https://vimeo.com/76979871/abc123def0'), 'https://vimeo.com/76979871/abc123def0');
  assert.equal(yt('https://player.vimeo.com/video/76979871?h=abc123def0'), 'https://vimeo.com/76979871/abc123def0');
  assert.equal(yt('https://vimeo.com/channels/staffpicks/76979871'), 'https://vimeo.com/76979871');
  for (const bad of ['https://example.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=short', 'not a url', 'https://vimeo.com/about', 'javascript:alert(1)']) {
    assert.equal(parseVideoUrl(bad), null, bad);
  }
});

// Fake YouTube/Vimeo so tests run offline and deterministically.
const requested = [];
async function fakeFetch(url) {
  requested.push(url);
  const u = new URL(url);
  const img = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#2a6' } }).jpeg().toBuffer();
  const ok = (body, type) => new Response(body, { status: 200, headers: { 'content-type': type } });
  if (u.hostname === 'www.youtube.com' && u.pathname === '/oembed') return ok(JSON.stringify({ title: 'School Concert 2026' }), 'application/json');
  if (u.hostname === 'i.ytimg.com') {
    if (u.pathname.includes('OLDOLDOLD00')) return u.pathname.endsWith('hqdefault.jpg') ? ok(await img(480, 360), 'image/jpeg') : new Response('', { status: 404 });
    if (u.pathname.endsWith('maxresdefault.jpg')) return ok(await img(1280, 720), 'image/jpeg');
  }
  if (u.hostname === 'vimeo.com' && u.pathname === '/api/oembed.json') {
    if (u.searchParams.get('url').includes('11111111')) return new Response('', { status: 404 });
    return ok(JSON.stringify({ title: 'Sports Day', thumbnail_url: 'https://i.vimeocdn.com/video/1-d_1280' }), 'application/json');
  }
  if (u.hostname === 'i.vimeocdn.com') return ok(await img(1280, 720), 'image/jpeg');
  return new Response('', { status: 404 });
}

let t, api;
before(async () => {
  t = await startApp({ fetch: fakeFetch, now: () => new Date(2026, 10, 3) });
  api = await t.userClient('vid', 'editor', 'video tester password');
});
after(() => t?.close());

const post = (body) => api.fetch('/api/video', { method: 'POST', json: body });

test('YouTube link → stored 1200px thumbnail with a play button, plus the title', async () => {
  const res = await post({ url: 'https://youtu.be/dQw4w9WgXcQ', project: 'Concert' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.provider, 'youtube');
  assert.equal(body.title, 'School Concert 2026');
  assert.equal(body.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(body.thumbnail.url, '/uploads/2026/11/Concert/video-youtube-dqw4w9wgxcq.jpg');
  // The play button makes the centre different from the plain green edges.
  const { data } = await sharp(path.join(t.dir, body.thumbnail.path)).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.subarray((y * 1200 + x) * 3, (y * 1200 + x) * 3 + 3)];
  assert.equal(body.thumbnail.width, 1200);
  assert.equal(body.thumbnail.height, 675);
  assert.ok(Math.abs(px(10, 10)[1] - 0xaa) < 12, 'edge keeps thumbnail colour');
  assert.ok(px(600 + 25, 337).every((c) => c > 200), 'centre has the white play arrow');
});

test('old YouTube videos fall back to the 4:3 thumbnail and crop the black bars', async () => {
  const res = await post({ url: 'https://www.youtube.com/watch?v=OLDOLDOLD00', project: 'Concert' });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.thumbnail.width, 480);
  assert.equal(body.thumbnail.height, 270);
});

test('Vimeo link → thumbnail from Vimeo oEmbed', async () => {
  const res = await post({ url: 'https://vimeo.com/76979871', project: 'Sport', style: 'light' });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal(body.provider, 'vimeo');
  assert.equal(body.title, 'Sports Day');
  assert.match(body.thumbnail.url, /^\/uploads\/2026\/11\/Sport\/video-vimeo-76979871\.jpg$/);
  assert.ok(requested.some((u) => u.startsWith('https://vimeo.com/api/oembed.json?width=1280&url=')));
});

test('helpful errors for unsupported links and private videos', async () => {
  const bad = await post({ url: 'https://example.com/video.mp4' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /YouTube or Vimeo link/);
  const priv = await post({ url: 'https://vimeo.com/11111111' });
  assert.equal(priv.status, 404);
  assert.match((await priv.json()).error, /public/);
});

test('only YouTube and Vimeo hosts are ever fetched', () => {
  for (const u of requested) assert.match(new URL(u).hostname, /^(www\.youtube\.com|i\.ytimg\.com|vimeo\.com|i\.vimeocdn\.com)$/);
});

test('video block exports as a linked image with alt text', () => {
  const doc = createDocument('V');
  doc.blocks = [createBlock('video', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'School Concert', thumbnailSrc: '/uploads/2026/11/V/video-youtube-x.jpg' })];
  const { html, warnings } = exportEmail(doc, { baseUrl: 'https://mail.example.org' });
  assert.match(html, /<a href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ" target="_blank"[^>]*><img src="https:\/\/mail\.example\.org\/uploads\/2026\/11\/V\/video-youtube-x\.jpg" alt="Play video: School Concert" width="540"/);
  assert.deepEqual(warnings.filter((w) => /video/i.test(w)), []);
  doc.blocks[0].props.thumbnailSrc = '';
  assert.ok(exportEmail(doc).warnings.some((w) => /no video thumbnail/.test(w)));
});
