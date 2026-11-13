#!/usr/bin/env node
/**
 * Compare HTML before and after Synergetic, to see what it strips or rewrites.
 *
 *   npm run synergetic-compare -- before.html after.html
 *   npm run synergetic-compare -- docs/synergetic-tests      (every NN-*.html with a NN-*.after.html)
 *
 * Reports only what changed: doctype, missing test labels (T3.30 …), elements,
 * attributes, inline CSS properties, comments and Outlook conditionals,
 * <style> blocks and media queries, character encoding and tag style.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ATTRS = String.raw`((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)`;
const TAG_RE = new RegExp(String.raw`<([a-zA-Z][\w:-]*)${ATTRS}\s*(/?)>`, 'g');
const ATTR_RE = /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

const inc = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
const unquote = (v) => (v && /^["']/.test(v) ? v.slice(1, -1) : v ?? '');

function analyse(html) {
  const comments = [...html.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);
  const conditional = comments.filter((c) => /^<!--\[if|<!\[endif\]|^<!--<!\[endif/.test(c));
  // Outside comments only, so Outlook-only markup is counted separately.
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  const styles = [...body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const markup = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  const text = markup.replace(/<[^>]+>/g, ' ');

  const tags = new Map();
  const attrs = new Map();
  const css = new Map();
  const cssValues = new Map();
  let selfClosing = 0;
  for (const [, rawName, rawAttrs, slash] of markup.matchAll(TAG_RE)) {
    const tag = rawName.toLowerCase();
    inc(tags, tag);
    if (slash) selfClosing++;
    for (const [, rawAttr, rawVal] of rawAttrs.matchAll(ATTR_RE)) {
      const attr = rawAttr.toLowerCase();
      inc(attrs, `${tag}@${attr}`);
      if (attr === 'style') {
        for (const decl of unquote(rawVal).split(/;(?![^(]*\))/)) {
          const i = decl.indexOf(':');
          if (i < 0) continue;
          const prop = decl.slice(0, i).trim().toLowerCase();
          if (!prop) continue;
          inc(css, prop);
          inc(cssValues, `${prop}: ${decl.slice(i + 1).trim()}`);
        }
      }
    }
  }
  return {
    doctype: (/<!doctype[^>]*>/i.exec(html) || ['(none)'])[0],
    labels: new Set([...text.matchAll(/\bT\d+\.\d+[a-z]?\b/g)].map((m) => m[0])),
    tags,
    attrs,
    css,
    cssValues,
    selfClosing,
    comments: comments.length - conditional.length,
    conditional: conditional.length,
    styleBlocks: styles.length,
    mediaQueries: styles.join('\n').match(/@media/g)?.length || 0,
    styleRules: styles.join('\n').match(/\{/g)?.length || 0,
    rawNonAscii: (markup.match(/[^\x00-\x7f]/gu) || []).length,
    numericRefs: (markup.match(/&#x?[0-9a-f]+;/gi) || []).length,
    namedRefs: (markup.match(/&[a-z][a-z0-9]*;/gi) || []).length,
    bytes: Buffer.byteLength(html),
  };
}

function diffMaps(title, a, b, { limit = 60 } = {}) {
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const rows = keys.filter((k) => (a.get(k) || 0) !== (b.get(k) || 0)).map((k) => {
    const x = a.get(k) || 0;
    const y = b.get(k) || 0;
    const note = y === 0 ? '  REMOVED' : x === 0 ? '  ADDED' : '';
    return `    ${k.padEnd(42)} ${String(x).padStart(4)} → ${String(y).padEnd(4)}${note}`;
  });
  if (!rows.length) return [];
  return [`  ${title}:`, ...rows.slice(0, limit), ...(rows.length > limit ? [`    … and ${rows.length - limit} more`] : [])];
}

function compare(beforeFile, afterFile) {
  const a = analyse(readFileSync(beforeFile, 'utf8'));
  const b = analyse(readFileSync(afterFile, 'utf8'));
  const out = [`\n=== ${path.basename(beforeFile)}  →  ${path.basename(afterFile)} ===`];
  out.push(`  Size: ${a.bytes} → ${b.bytes} bytes`);
  if (a.doctype !== b.doctype) out.push(`  Doctype changed:\n    before: ${a.doctype}\n    after:  ${b.doctype}`);
  const missing = [...a.labels].filter((l) => !b.labels.has(l));
  if (missing.length) out.push(`  Test labels missing after (whole case dropped): ${missing.join(', ')}`);
  const scalar = [
    ['Plain comments', 'comments'],
    ['Outlook conditional comments', 'conditional'],
    ['<style> blocks', 'styleBlocks'],
    ['CSS rules in <style>', 'styleRules'],
    ['@media queries', 'mediaQueries'],
    ['Self-closing tags (" />")', 'selfClosing'],
    ['Raw non-ASCII characters', 'rawNonAscii'],
    ['Numeric character refs (&#…;)', 'numericRefs'],
    ['Named entities (&name;)', 'namedRefs'],
  ]
    .filter(([, k]) => a[k] !== b[k])
    .map(([label, k]) => `    ${label.padEnd(42)} ${String(a[k]).padStart(4)} → ${b[k]}`);
  if (scalar.length) out.push('  Counts:', ...scalar);
  out.push(...diffMaps('Elements', a.tags, b.tags));
  out.push(...diffMaps('Attributes (tag@attribute)', a.attrs, b.attrs));
  out.push(...diffMaps('Inline CSS properties', a.css, b.css));
  out.push(...diffMaps('Inline CSS values (property: value)', a.cssValues, b.cssValues, { limit: 40 }));
  if (out.length === 2) out.push('  No differences found.');
  return out.join('\n');
}

const args = process.argv.slice(2);
if (args.length === 1 && existsSync(args[0]) && statSync(args[0]).isDirectory()) {
  const dir = args[0];
  const pairs = readdirSync(dir)
    .filter((f) => /\.html$/.test(f) && !/\.after\.html$/.test(f))
    .map((f) => [path.join(dir, f), path.join(dir, f.replace(/\.html$/, '.after.html'))])
    .filter(([, after]) => existsSync(after));
  if (!pairs.length) {
    console.log(`No *.after.html files found in ${dir}. Save Synergetic's version of each test next to it as NN-name.after.html.`);
    process.exit(1);
  }
  for (const [before, after] of pairs) console.log(compare(before, after));
} else if (args.length === 2) {
  console.log(compare(args[0], args[1]));
} else {
  console.log('Usage: npm run synergetic-compare -- before.html after.html\n       npm run synergetic-compare -- docs/synergetic-tests');
  process.exit(1);
}
