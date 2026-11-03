import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportEmail, toXhtml } from '../server/lib/exporter.js';
import { createDocument, createBlock, BLOCK_TYPES } from '../shared/blocks.js';

function docWithEverything() {
  const doc = createDocument('Test Project');
  doc.settings.subject = 'Weekly Bulletin';
  doc.settings.preheader = 'This week at school';
  doc.blocks.push(
    createBlock('image', { src: '/uploads/2026/11/Test-Project/hero.png', alt: 'Hero', href: 'https://example.com' }),
    createBlock('spacer'),
    createBlock('html', { html: '<p style="margin:0">Raw<br>content</p>' }),
  );
  doc.blocks[1].props.html =
    '<h2>Café “News”</h2><p>Text&nbsp;with &copy; entities<br>and a <a href="https://example.com/?a=1&b=2">link</a>.</p>' +
    '<ul><li>One</li><li>Two</li></ul><table border="1"><tbody><tr><td nowrap>Cell</td></tr></tbody></table>';
  return doc;
}

test('exports the exact XHTML 1.0 Transitional doctype and namespace', () => {
  const { html } = exportEmail(docWithEverything());
  assert.ok(html.startsWith('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'));
  assert.match(html, /<html xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(html, /<meta http-equiv="Content-Type" content="text\/html; charset=UTF-8" \/>/);
  assert.match(html, /<title>Weekly Bulletin<\/title>/);
});

test('inlines global CSS into style attributes and keeps only media queries in <head>', () => {
  const { html } = exportEmail(docWithEverything());
  const styleBlocks = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  assert.equal(styleBlocks.length, 1);
  assert.match(styleBlocks[0].trim(), /^@media/);
  // Class rules for rich text were inlined onto the elements.
  assert.match(html, /<h2 style="[^"]*font-family: Arial, Helvetica, sans-serif;[^"]*font-weight: bold;/);
  assert.match(html, /<p style="[^"]*margin: 0 0 16px 0;/);
  assert.match(html, /<li style="[^"]*font-size: 16px;/);
  assert.match(html, /<a href="https:\/\/example\.com\/\?a=1&amp;b=2" style="[^"]*color: #1a5fb4;/);
});

test('uses table-based layout only — no flexbox, grid, floats or positioning', () => {
  const { html } = exportEmail(docWithEverything());
  assert.doesNotMatch(html, /display:\s*(flex|grid|inline-flex)/i);
  assert.doesNotMatch(html, /\bfloat:\s*(left|right)/i);
  assert.doesNotMatch(html, /position:\s*(absolute|fixed|relative)/i);
  assert.match(html, /<table class="ae-container" width="600" cellpadding="0" cellspacing="0" border="0"/);
  // Each row table has an explicit pixel width attribute.
  const rows = [...html.matchAll(/<table class="ae-row[^"]*" width="(\d+)"/g)];
  assert.ok(rows.length >= 8);
  for (const r of rows) assert.equal(r[1], '600');
  // Outlook ghost table.
  assert.match(html, /<!--\[if mso\]><table align="center" width="600"/);
});

test('produces well-formed XHTML: self-closed void tags, numeric entities, 7-bit output', () => {
  const { html } = exportEmail(docWithEverything());
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /<(br|img|meta|hr)\b[^>]*[^/]>/);
  assert.match(html, /<br \/>/);
  assert.match(html, /Caf&#233; &#8220;News&#8221;/);
  assert.match(html, /Text&#160;with &#169; entities/);
  assert.match(html, /<td nowrap="nowrap"/);
  assert.doesNotMatch(html, /[^\x00-\x7f]/);
  assert.doesNotMatch(html, /&nbsp;|&copy;/);
});

test('passes xmllint well-formedness check (when xmllint is installed)', (t) => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
  } catch {
    return t.skip('xmllint not available');
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'atelier-'));
  const file = path.join(dir, 'email.html');
  writeFileSync(file, exportEmail(docWithEverything()).html);
  execFileSync('xmllint', ['--noout', '--nonet', file]); // throws on error
});

test('strict mode omits attributes the XHTML 1.0 DTD does not define', () => {
  const doc = docWithEverything();
  let { html } = exportEmail(doc);
  assert.doesNotMatch(html, /role="presentation"|data-ae-|xmlns:v=|contenteditable/);
  doc.settings.strictXhtml = false;
  ({ html } = exportEmail(doc));
  assert.match(html, /role="presentation"/);
  assert.match(html, /xmlns:o="urn:schemas-microsoft-com:office:office"/);
});

test('makes uploaded image paths absolute using the asset base URL', () => {
  const doc = docWithEverything();
  let { html } = exportEmail(doc, { baseUrl: 'https://mail.school.example' });
  assert.match(html, /src="https:\/\/mail\.school\.example\/uploads\/2026\/11\/Test-Project\/hero\.png"/);
  doc.settings.assetBaseUrl = 'https://cdn.example.org/';
  ({ html } = exportEmail(doc, { baseUrl: 'https://ignored.example' }));
  assert.match(html, /src="https:\/\/cdn\.example\.org\/uploads\/2026\/11\/Test-Project\/hero\.png"/);
  assert.match(html, /<img [^>]*alt="Hero"[^>]*width="600"/);
});

test('sanitises dangerous values coming from the document JSON', () => {
  const doc = createDocument('X');
  doc.blocks = [
    createBlock('button', { href: 'javascript:alert(1)', text: '<b>x</b>', btnColor: 'red;background:url(x)' }),
    createBlock('image', { src: 'javascript:alert(1)', alt: '"><script>' }),
  ];
  const { html } = exportEmail(doc);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /bgcolor="#1a5fb4"/);
});

test('every block type renders and is preceded by lint warnings where relevant', () => {
  const doc = createDocument('All');
  doc.blocks = Object.keys(BLOCK_TYPES).map((t) => createBlock(t));
  const { html, warnings } = exportEmail(doc);
  assert.ok(html.length > 1000);
  assert.ok(warnings.some((w) => /no image selected/.test(w)));
});

test('two-column widths add up to the content width', () => {
  const doc = createDocument('Cols');
  doc.blocks = [createBlock('columns2', { ratio: '33', gap: 20, paddingX: 30 })];
  const { html } = exportEmail(doc);
  const widths = [...html.matchAll(/<td class="ae-col[^"]*" width="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 3);
  assert.equal(widths.reduce((a, b) => a + b, 0), 600 - 60);
});

test('toXhtml leaves MSO conditional comments untouched', () => {
  const out = toXhtml('<html><body><!--[if mso]><table><tr><td><br><![endif]--><br></body></html>');
  assert.match(out, /<!--\[if mso\]><table><tr><td><br><!\[endif\]--><br \/>/);
});
