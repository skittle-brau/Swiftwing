import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportEmail } from '../server/lib/exporter.js';
import { createDocument, createBlock } from '../shared/blocks.js';

const IMG = '/uploads/2026/11/T/a.jpg';
const exp = (blocks, settings = {}) => {
  const doc = createDocument('Blocks');
  Object.assign(doc.settings, settings);
  doc.blocks = blocks;
  return exportEmail(doc, { baseUrl: 'https://mail.example.org' });
};

test('Image Group: rows of equal columns, captions, wrapping, missing pictures warned', () => {
  const images = [1, 2, 3, 4].map((k) => ({ src: IMG, alt: `Photo ${k}`, href: '', caption: k === 1 ? 'First' : '' }));
  const { html } = exp([createBlock('imageGroup', { images, perRow: '3', gap: 10 })]);
  // 540px inside padding: (540 - 2×10) / 3 = 173px each.
  assert.equal((html.match(/<img [^>]*width="173"/g) || []).length, 4);
  assert.equal((html.match(/<td class="ae-gcell ae-g3" width="173"/g) || []).length, 6); // 2 rows × 3, last row padded
  assert.match(html, /<td colspan="5" height="10"/); // gap between rows
  assert.match(html, />First<\/div>/);

  const stacked = exp([createBlock('imageGroup', { images, perRow: '2', stackOnMobile: true })]).html;
  assert.match(stacked, /<td class="ae-col" width="265"/);

  const { warnings } = exp([createBlock('imageGroup')]);
  assert.ok(warnings.some((w) => /image 1 has no picture yet/.test(w)));
});

test('Image Card: bordered card with image, title, description and optional button', () => {
  const cards = [
    { imageSrc: IMG, imageAlt: 'Camp', imageHref: '', title: 'Year 7 camp', html: '<p>Photos are up.</p>', buttonText: 'View photos', buttonHref: 'https://example.com/camp' },
    { imageSrc: '', imageAlt: '', imageHref: '', title: 'No image card', html: '<p>Text only.</p>', buttonText: '', buttonHref: '' },
  ];
  const { html } = exp([createBlock('imageCard', { cards, perRow: '2', gap: 20, borderWidth: 1, borderColor: '#cccccc', radius: 8, cardBg: '#fafafa' })]);
  assert.equal((html.match(/<table [^>]*bgcolor="#fafafa"[^>]*border: 1px solid #cccccc; border-radius: 8px;/g) || []).length, 2);
  assert.match(html, /<img [^>]*alt="Camp" width="258"/); // (540-20)/2 = 260, minus 2×1px border
  assert.match(html, /<h3 [^>]*font-size: ?18px;[^>]*><span>Year 7 camp<\/span><\/h3>/);
  assert.match(html, /<a href="https:\/\/example\.com\/camp"[^>]*>View photos<\/a>/);
  assert.equal((html.match(/>View photos</g) || []).length, 1); // second card has no button
  assert.match(html, /<td class="ae-col" width="260"/); // cards stack on phones
});

test('Image + Text: left, right (dir=rtl so the image stacks first) and above', () => {
  const base = { imageSrc: IMG, imageAlt: 'Library', imageWidth: 200, gap: 20 };
  const left = exp([createBlock('imageText', { ...base, imagePosition: 'left' })]).html;
  assert.match(left, /<table width="100%"[^>]*dir="ltr"[^>]*max-width: 540px;/);
  assert.match(left, /<td class="ae-col" width="200"[^>]*dir="ltr"[^>]*><img [^>]*width="200"/);
  assert.match(left, /<td class="ae-col ae-cell" width="320"/);

  const right = exp([createBlock('imageText', { ...base, imagePosition: 'right' })]).html;
  assert.match(right, /<table width="100%"[^>]*dir="rtl"[^>]*max-width: 540px;/);
  // Image cell still comes first in the markup.
  assert.ok(right.indexOf('alt="Library"') < right.indexOf('Write something'));

  const top = exp([createBlock('imageText', { ...base, imagePosition: 'top', topImageWidth: 0 })]).html;
  assert.match(top, /<img [^>]*alt="Library" width="540"/);
  assert.doesNotMatch(top, /dir="rtl"/);

  const full = exp([createBlock('imageText', { ...base, imagePosition: 'left' })], { fullWidth: true }).html;
  assert.match(full, /<table width="100%"[^>]*dir="ltr"/);
  assert.doesNotMatch(full, /max-width: 540px/);
  assert.match(full, /<td class="ae-col ae-cell" valign/); // text column fills the rest
});

test('Boxed Text: box, accent bar, quote and plain styles', () => {
  const cell = (props) => {
    const { html } = exp([createBlock('boxedText', { boxBg: '#eef4fc', accentColor: '#1a5fb4', ...props })]);
    return /<td class="ae-cell" bgcolor="#eef4fc"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? '';
  };
  assert.match(cell({ variant: 'box', borderWidth: 2 }), /border: 2px solid #1a5fb4;/);
  assert.match(cell({ variant: 'accent', borderWidth: 1 }), /border-left: 3px solid #1a5fb4;/); // minimum 3px bar
  assert.doesNotMatch(cell({ variant: 'plain' }), /border(-left)?: \d/);
  const quote = exp([createBlock('boxedText', { variant: 'quote', html: '<p>Education is not filling a pail.</p>' })]).html;
  assert.match(quote, /<p style="[^"]*font-style: italic;[^"]*font-size: 18px;/);
});

test('all new blocks export well-formed XHTML', (t) => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
  } catch {
    return t.skip('xmllint not available');
  }
  const { html } = exp(['imageGroup', 'imageCard', 'imageText', 'boxedText'].map((type) => createBlock(type)));
  const dir = mkdtempSync(path.join(tmpdir(), 'swiftwing-'));
  writeFileSync(path.join(dir, 'blocks.html'), html);
  execFileSync('xmllint', ['--noout', '--nonet', path.join(dir, 'blocks.html')]);
});
