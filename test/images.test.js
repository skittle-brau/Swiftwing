import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { optimizeImage, ImageError } from '../server/lib/images.js';

const noise = (w, h, channels = 3) => {
  const buf = Buffer.alloc(w * h * channels);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 2654435761) >>> 24;
  return sharp(buf, { raw: { width: w, height: h, channels } });
};

test('downscales wide JPEGs to 1200px and re-compresses them', async () => {
  const input = await noise(3000, 2000).jpeg({ quality: 100 }).toBuffer();
  const out = await optimizeImage(input);
  assert.equal(out.mime, 'image/jpeg');
  assert.equal(out.width, 1200);
  assert.equal(out.height, 800);
  assert.equal(out.resized, true);
  assert.ok(out.buffer.length < input.length);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.isProgressive, true);
});

test('never upscales small images', async () => {
  const input = await noise(400, 300).jpeg().toBuffer();
  const out = await optimizeImage(input);
  assert.equal(out.width, 400);
  assert.equal(out.resized, false);
});

test('honours a custom maximum width', async () => {
  const input = await noise(1000, 500).png().toBuffer();
  const out = await optimizeImage(input, { maxWidth: 600 });
  assert.equal(out.width, 600);
  assert.equal(out.height, 300);
});

test('applies EXIF rotation and strips metadata (e.g. GPS)', async () => {
  const input = await noise(3000, 2000)
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '33/1 51/1 0/1' } } })
    .toBuffer();
  const out = await optimizeImage(input);
  // 3000×2000 rotated 90° is 2000×3000, then scaled to 1200 wide.
  assert.equal(out.width, 1200);
  assert.equal(out.height, 1800);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.orientation, undefined);
  assert.equal(meta.exif, undefined);
});

test('converts WebP to JPEG, or to PNG when it has transparency', async () => {
  const opaque = await optimizeImage(await noise(800, 400).webp().toBuffer());
  assert.equal(opaque.mime, 'image/jpeg');
  assert.equal(opaque.converted, true);
  const alpha = await optimizeImage(await noise(800, 400, 4).webp().toBuffer());
  assert.equal(alpha.mime, 'image/png');
  assert.equal((await sharp(alpha.buffer).metadata()).hasAlpha, true);
});

test('keeps an already-optimal small PNG byte-for-byte', async () => {
  const input = await sharp({ create: { width: 200, height: 100, channels: 4, background: '#1a3a5c' } }).png({ compressionLevel: 9 }).toBuffer();
  const out = await optimizeImage(input);
  assert.equal(out.mime, 'image/png');
  assert.ok(out.buffer.length <= input.length);
});

test('resizes animated GIFs and keeps every frame', async () => {
  const frames = 3;
  const raw = await noise(1600, 200 * frames, 4).raw().toBuffer();
  const gif = await sharp(raw, { raw: { width: 1600, height: 200 * frames, channels: 4, pageHeight: 200 } }).gif().toBuffer();
  const out = await optimizeImage(gif);
  const meta = await sharp(out.buffer, { animated: true }).metadata();
  assert.equal(out.mime, 'image/gif');
  assert.equal(meta.pages, frames);
  assert.equal(meta.width, 1200);
  assert.equal(out.height, 150);
});

test('rejects files that are not images, whatever their claimed type', async () => {
  await assert.rejects(optimizeImage(Buffer.from('<html>not an image</html>')), ImageError);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  await assert.rejects(optimizeImage(svg), /Unsupported image format "svg"/);
});
