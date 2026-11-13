#!/usr/bin/env node
/**
 * Regenerate the full-export files in docs/synergetic-tests/ (10–12):
 * one email containing every block type, exported in each doctype.
 *
 *   npm run synergetic-tests
 *   npm run synergetic-tests -- --base-url https://email.yourschool.example
 *
 * --base-url sets the address the test images point at (default: example.org,
 * so images show as broken, which is fine for comparing code).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCK_TYPES, createBlock, createDocument } from '../shared/blocks.js';
import { DOCTYPES } from '../shared/render.js';
import { exportEmail } from '../server/lib/exporter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'synergetic-tests');
const argIdx = process.argv.indexOf('--base-url');
const baseUrl = argIdx > 0 ? process.argv[argIdx + 1] : 'https://email.example.org';
const IMG = '/uploads/2026/11/Synergetic-Test/test-image.jpg';

/** Sample content so every block exports something visible. */
const SAMPLE = {
  header: { logoSrc: IMG, logoAlt: 'School logo', html: '<h1>Swiftwing full export</h1><p>Every block type, in one email</p>' },
  text: {
    html:
      '<h2>Text block</h2><p>Paragraph with <strong>bold</strong>, <em>italic</em>, <u>underline</u> and a <a href="https://example.org/?a=1&amp;b=2">link</a>. Café “quotes” — &copy; 2026.</p>' +
      '<ul><li>Bullet one</li><li>Bullet two</li></ul><ol><li>Number one</li><li>Number two</li></ol>' +
      '<table border="1" style="border-collapse: collapse; width: 100%;"><tbody><tr><td>Rich-text table</td><td>Cell</td></tr></tbody></table>',
  },
  image: { src: IMG, alt: 'Full-width image', href: 'https://example.org/image' },
  video: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Sample video', thumbnailSrc: IMG },
  columns2: {
    columns: [
      { imageSrc: IMG, imageAlt: 'Left', imageHref: '', html: '<h3>Left column</h3><p>Column text.</p>' },
      { imageSrc: IMG, imageAlt: 'Right', imageHref: '', html: '<h3>Right column</h3><p>Column text.</p>' },
    ],
  },
  imageGroup: { images: [1, 2, 3].map((k) => ({ src: IMG, alt: `Group image ${k}`, href: '', caption: `Caption ${k}` })) },
  imageText: { imageSrc: IMG, imageAlt: 'Image beside text' },
};

const doc = createDocument('Synergetic Test');
doc.settings.subject = 'Swiftwing test: full export';
doc.settings.preheader = 'Preheader text for the Synergetic test';
doc.blocks = Object.keys(BLOCK_TYPES).map((type) => {
  const block = createBlock(type, SAMPLE[type] || {});
  if (type === 'imageCard') block.props.cards = block.props.cards.map((c, k) => ({ ...c, imageSrc: IMG, imageAlt: `Card ${k + 1}` }));
  return block;
});

let n = 10;
for (const [key, dt] of Object.entries(DOCTYPES)) {
  doc.settings.doctype = key;
  const { html } = exportEmail(doc, { baseUrl });
  const file = `${n}-swiftwing-export-${key}.html`;
  writeFileSync(path.join(OUT, file), html);
  console.log(`wrote docs/synergetic-tests/${file} (${dt.label}, ${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, ${doc.blocks.length} blocks)`);
  n++;
}
