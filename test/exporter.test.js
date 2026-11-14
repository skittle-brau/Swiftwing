import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportEmail, toXhtml } from '../server/lib/exporter.js';
import { createDocument, createBlock, BLOCK_TYPES } from '../shared/blocks.js';

function docWithEverything() {
  const doc = createDocument('Test Project');
  doc.settings.subject = 'Weekly Bulletin';
  doc.settings.doctype = 'xhtml'; // most checks below are XHTML-specific; HTML 4.01 / HTML5 are tested at the end
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
  const dir = mkdtempSync(path.join(tmpdir(), 'swiftwing-'));
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

test('full-width layout: 100% tables, percentage columns, pixel-sized images', (t) => {
  const doc = docWithEverything();
  doc.settings.fullWidth = true;
  doc.blocks.push(createBlock('columns2', { ratio: '33' }));
  const { html } = exportEmail(doc);
  assert.match(html, /<table class="ae-container" width="100%"/);
  const rows = [...html.matchAll(/<table class="ae-row[^"]*" width="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(rows.length >= 8);
  assert.ok(rows.every((w) => w === '100%'));
  assert.doesNotMatch(html, /<table class="ae-row[^>]*width: 600px/);
  // No fixed-width Outlook wrapper and no grey margin above/below.
  assert.doesNotMatch(html, /<!--\[if mso\]><table align="center" width="600"/);
  assert.match(html, /<td align="center" valign="top" style="[^"]*padding: 0;/);
  // Columns split by percentage.
  const cols = [...html.matchAll(/<td class="ae-col ae-cell" width="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cols.slice(-2), ['33%', '67%']);
  // Images keep explicit pixel widths (Outlook ignores percentages on images).
  assert.match(html, /<img [^>]*alt="Hero" width="600"/);
  // Mobile stacking still applies.
  assert.match(html, /@media only screen and \(max-width:620px\)/);

  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
  } catch {
    return t.skip('xmllint not available');
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'swiftwing-'));
  writeFileSync(path.join(dir, 'full.html'), html);
  execFileSync('xmllint', ['--noout', '--nonet', path.join(dir, 'full.html')]);
});

test('fixed-width layout is unchanged by default', () => {
  const { html } = exportEmail(docWithEverything());
  assert.match(html, /<table class="ae-container" width="600"/);
  assert.match(html, /<!--\[if mso\]><table align="center" width="600"/);
});

test('two columns with fixed pixel widths (e.g. a co-authored byline)', () => {
  const doc = createDocument('Byline');
  doc.blocks = [createBlock('columns2', { ratio: 'fixed', leftWidth: 200, rightWidth: 180, gap: 20, gridAlign: 'center' })];
  for (const fullWidth of [false, true]) {
    doc.settings.fullWidth = fullWidth;
    const { html } = exportEmail(doc);
    assert.match(html, /<table width="400" cellpadding="0" cellspacing="0" border="0" align="center" style="[^"]*width: 400px; max-width: 100%;/);
    const cols = [...html.matchAll(/<td class="ae-col ae-cell" width="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(cols, ['200', '180'], `fullWidth=${fullWidth}`);
  }
  // Widths that don't fit are scaled down to the space available (600 - 2×30 padding - 20 gap).
  doc.settings.fullWidth = false;
  doc.blocks[0].props.leftWidth = 600;
  doc.blocks[0].props.rightWidth = 600;
  const cols = [...exportEmail(doc).html.matchAll(/<td class="ae-col ae-cell" width="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(cols[0] + cols[1], 520);
});

/* --------------------------------------------------------------- doctypes */

test('HTML 4.01 Transitional is the default doctype', () => {
  const doc = docWithEverything();
  delete doc.settings.doctype;
  const { html, doctype, doctypeLabel } = exportEmail(doc);
  assert.equal(doctype, 'html4');
  assert.equal(doctypeLabel, 'HTML 4.01 Transitional');
  assert.ok(html.startsWith('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">\n<html lang="en">'));
  assert.match(html, /<meta http-equiv="Content-Type" content="text\/html; charset=UTF-8">/);
  assert.match(html, /<style type="text\/css">/);
  // No XHTML-only syntax.
  assert.doesNotMatch(html, /xmlns=|xml:lang/);
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /\/>/);
  assert.match(html, /<br>/);
  assert.match(html, /<img [^>]*alt="Hero"[^>]*>/);
  // Still 7-bit, still inlined, still no ARIA role (not in HTML 4.01).
  assert.doesNotMatch(html, /[^\x00-\x7f]/);
  assert.match(html, /Caf&#233;/);
  assert.doesNotMatch(html, /role="presentation"/);
});

test('HTML5 output', () => {
  const doc = docWithEverything();
  doc.settings.doctype = 'html5';
  const { html } = exportEmail(doc);
  assert.ok(html.startsWith('<!DOCTYPE html>\n<html lang="en">'));
  assert.match(html, /<meta charset="UTF-8">/);
  assert.match(html, /<style>\n@media/);
  assert.doesNotMatch(html, /http-equiv="Content-Type"/);
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /\/>/);
  // role="presentation" is valid HTML5, so it's kept even in strict mode.
  assert.match(html, /<table class="ae-container"[^>]* role="presentation"/);
});

test('unknown doctypes fall back to HTML 4.01', () => {
  const doc = docWithEverything();
  doc.settings.doctype = 'html3';
  assert.equal(exportEmail(doc).doctype, 'html4');
});

test('HTML 4.01 and HTML5 output parse cleanly as HTML (when xmllint is installed)', (t) => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
  } catch {
    return t.skip('xmllint not available');
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'swiftwing-'));
  for (const doctype of ['html4', 'html5']) {
    const doc = docWithEverything();
    doc.settings.doctype = doctype;
    const file = path.join(dir, `${doctype}.html`);
    writeFileSync(file, exportEmail(doc).html);
    // libxml2's HTML parser reports problems (unclosed or misnested tags) on stderr
    // but exits 0, so check stderr rather than the exit code.
    const { stderr } = spawnSync('xmllint', ['--html', '--noout', file], { encoding: 'utf8' });
    assert.equal(stderr, '', `${doctype}: ${stderr}`);
  }
});
