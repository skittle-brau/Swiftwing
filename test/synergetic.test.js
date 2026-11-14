import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportEmail, SYNERGETIC_RULES } from '../server/lib/exporter.js';
import { createDocument } from '../shared/blocks.js';

test('Synergetic compatibility is off by default and reported when on', () => {
  const doc = createDocument('Syn');
  const off = exportEmail(doc);
  assert.equal(off.synergetic, false);
  doc.settings.synergetic = true;
  const on = exportEmail(doc);
  assert.equal(on.synergetic, true);
  // Stage 1: no rules yet, so the HTML is unchanged.
  assert.equal(SYNERGETIC_RULES.length, 0);
  assert.equal(on.html, off.html);
});

test('rules run in order, only when the option is on, and see the doctype', () => {
  const seen = [];
  SYNERGETIC_RULES.push(
    { id: 'first', description: 'test', apply: (html, ctx) => (seen.push(ctx.doctype), html.replace('<title>', '<title>[1]')) },
    { id: 'second', description: 'test', apply: (html) => html.replace('[1]', '[1][2]') },
  );
  try {
    const doc = createDocument('Syn');
    doc.settings.subject = 'Subject';
    assert.match(exportEmail(doc).html, /<title>Subject<\/title>/);
    doc.settings.synergetic = true;
    doc.settings.doctype = 'html5';
    const res = exportEmail(doc);
    assert.match(res.html, /<title>\[1\]\[2\]Subject<\/title>/);
    assert.deepEqual(res.synergeticRules, ['first', 'second']);
    assert.deepEqual(seen, ['html5']);
  } finally {
    SYNERGETIC_RULES.length = 0;
  }
});
