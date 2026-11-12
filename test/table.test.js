import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exportEmail } from '../server/lib/exporter.js';
import { createDocument, createBlock } from '../shared/blocks.js';
import { normalizeCells } from '../shared/render.js';

const docWith = (props) => {
  const doc = createDocument('Table');
  doc.blocks = [createBlock('table', props)];
  return exportEmail(doc).html;
};
const hasLine = (style, side = '') => new RegExp(`border${side}: \\d+px solid`).test(style);
const cellStyles = (html) => [...html.matchAll(/<t[dh] class="ae-cell[^"]*"[^>]*style="([^"]*)"/g)].map((m) => m[1]);

test('renders a header row, body rows and equal column widths', () => {
  const html = docWith({});
  assert.equal((html.match(/<th /g) || []).length, 3);
  assert.equal((html.match(/<td class="ae-cell"/g) || []).length, 6);
  assert.match(html, /<table class="ae-table" width="100%"[^>]*style="[^"]*border-collapse: collapse;/);
  const widths = [...html.matchAll(/<th class="ae-cell ae-th"[^>]* width="(\d+)%"/g)].map((m) => Number(m[1]));
  assert.deepEqual(widths, [33, 33, 34]);
  assert.match(html, /<th [^>]*bgcolor="#f1f3f6"[^>]*style="[^"]*font-weight: bold;/);
  assert.match(html, /Swimming carnival/);
});

test('border styles', () => {
  const all = cellStyles(docWith({ borderStyle: 'all', borderWidth: 2, borderColor: '#ff0000' }));
  assert.ok(all.every((s) => s.includes('border: 2px solid #ff0000')));

  const rows = cellStyles(docWith({ borderStyle: 'rows' }));
  assert.ok(rows.every((s) => hasLine(s, '-top') && !hasLine(s, '-left')));
  assert.ok(rows.slice(-3).every((s) => hasLine(s, '-bottom')));
  assert.ok(rows.slice(0, 3).every((s) => !hasLine(s, '-bottom')));

  const outer = cellStyles(docWith({ borderStyle: 'outer' }));
  assert.ok(hasLine(outer[0], '-top') && hasLine(outer[0], '-left') && !hasLine(outer[0], '-right'));
  assert.ok(!/border(-\w+)?: \d+px solid/.test(outer[4])); // middle cell has no lines

  const none = cellStyles(docWith({ borderStyle: 'none' }));
  assert.ok(none.every((s) => !/border(-\w+)?: \d+px solid/.test(s)));
});

test('cell padding, font size, alignment, stripes and no header', () => {
  const html = docWith({ cellPadding: 12, fontSize: 13, textAlign: 'center', valign: 'middle', stripeBg: '#fafafa', headerRow: false });
  assert.equal((html.match(/<th /g) || []).length, 0);
  const styles = cellStyles(html);
  assert.ok(styles.every((s) => s.includes('padding: 12px') && s.includes('font-size: 13px') && s.includes('text-align: center') && s.includes('vertical-align: middle')));
  // Rows 0 and 2 plain, row 1 striped.
  const rowBgs = [...html.matchAll(/<tr>(<td class="ae-cell"[^>]*>)/g)].map((m) => /bgcolor="([^"]+)"/.exec(m[1])?.[1] ?? null);
  assert.deepEqual(rowBgs, [null, '#fafafa', null]);
  // Text inside cells uses the table's font size, not the email's 16px body size.
  assert.match(html, /<p style="[^"]*font-size: 13px;/);
});

test('empty cells keep their height and "fit content" drops fixed widths', () => {
  const html = docWith({ cells: [['<p>A</p>', ''], ['', '<p>D</p>']], colWidths: 'auto', headerRow: false });
  assert.equal((html.match(/&#160;<\/div>/g) || []).length, 2);
  assert.doesNotMatch(html, /<td class="ae-cell"[^>]* width="/);
});

test('ragged or missing cell data is made rectangular', () => {
  assert.deepEqual(normalizeCells([['a'], ['b', 'c', 'd']]), [['a', '', ''], ['b', 'c', 'd']]);
  assert.deepEqual(normalizeCells(undefined), [['']]);
  assert.deepEqual(normalizeCells([]), [['']]);
});

test('table export is well-formed XHTML', (t) => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
  } catch {
    return t.skip('xmllint not available');
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'swiftwing-'));
  const file = path.join(dir, 'table.html');
  writeFileSync(file, docWith({ borderStyle: 'outer', stripeBg: '#eeeeee' }));
  execFileSync('xmllint', ['--noout', '--nonet', file]);
});
