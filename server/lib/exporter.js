/**
 * Export engine: document JSON → Synergetic-ready XHTML 1.0 Transitional.
 *
 * Pipeline
 *   1. renderEmailDocument()  table-based markup + class-based <style>
 *   2. juice                  inline every CSS rule into style="" attributes,
 *                             keeping only @media rules in <head>
 *   3. toXhtml()              self-close void elements, expand boolean attrs,
 *                             convert all non-ASCII / named entities to numeric
 *                             references (survives any charset mangling)
 *   4. lint()                 warnings for the UI (alt text, sizes, URLs…)
 */
import juice from 'juice';
import { decodeHTML } from 'entities';
import { renderEmailDocument, XHTML_DOCTYPE, normalizeSettings } from '../../shared/render.js';
import { normalizeDocument } from '../../shared/blocks.js';

const VOID_TAGS = ['area', 'base', 'br', 'col', 'hr', 'img', 'input', 'link', 'meta', 'param'];
const BOOLEAN_ATTRS = ['nowrap', 'noshade', 'checked', 'selected', 'disabled', 'readonly', 'compact', 'noresize'];
const XML_SAFE_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot']);

const JUICE_OPTIONS = {
  removeStyleTags: true,
  preserveMediaQueries: true,
  preserveFontFaces: true,
  preserveImportant: true,
  applyWidthAttributes: true,
  applyHeightAttributes: false,
  applyAttributesTableElements: true,
  insertPreservedExtraCss: true,
  inlinePseudoElements: false,
};

/** Split HTML into comment and non-comment segments so MSO conditionals are untouched. */
function mapOutsideComments(html, fn) {
  return html
    .split(/(<!--[\s\S]*?-->)/g)
    .map((part) => (part.startsWith('<!--') ? part : fn(part)))
    .join('');
}

const ATTRS = String.raw`((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)`;
const TAG_RE = new RegExp(String.raw`<([a-zA-Z][\w:-]*)${ATTRS}\s*(/?)>`, 'g');
const ATTR_RE = /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
const VOID_CLOSE_RE = new RegExp(String.raw`</(${VOID_TAGS.join('|')})\s*>`, 'gi');

/** Rebuild a start tag as XHTML: lowercase names, quoted values, no minimised attributes. */
function xhtmlTag(_m, name, attrs) {
  const tag = name.toLowerCase();
  const out = [];
  for (const [, rawName, rawVal] of attrs.matchAll(ATTR_RE)) {
    const attr = rawName.toLowerCase();
    let val;
    if (rawVal === undefined || rawVal === '""' || rawVal === "''") {
      val = BOOLEAN_ATTRS.includes(attr) ? attr : '';
    } else if (rawVal[0] === '"') {
      val = rawVal.slice(1, -1);
    } else if (rawVal[0] === "'") {
      val = rawVal.slice(1, -1).replace(/"/g, '&quot;');
    } else {
      val = rawVal.replace(/"/g, '&quot;');
    }
    if (BOOLEAN_ATTRS.includes(attr) && !val) val = attr;
    out.push(` ${attr}="${val}"`);
  }
  return `<${tag}${out.join('')}${VOID_TAGS.includes(tag) ? ' /' : ''}>`;
}

export function toXhtml(html) {
  let out = mapOutsideComments(html, (seg) => seg.replace(VOID_CLOSE_RE, '').replace(TAG_RE, xhtmlTag));

  // Named entities (other than the XML built-ins) → numeric references.
  out = out.replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, name) => {
    if (XML_SAFE_ENTITIES.has(name)) return m;
    if (name === 'apos') return '&#39;';
    const decoded = decodeHTML(m);
    if (decoded === m) return `&amp;${name};`; // unknown entity → literal text
    return [...decoded].map((ch) => `&#${ch.codePointAt(0)};`).join('');
  });

  // Bare ampersands that aren't entity references.
  out = out.replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;');

  // Non-ASCII characters → numeric references (7-bit safe output).
  out = out.replace(/[^\x00-\x7f]/gu, (ch) => `&#${ch.codePointAt(0)};`);

  // Guarantee the exact XHTML 1.0 Transitional doctype.
  out = out.replace(/^\s*<!doctype[^>]*>/i, '');
  return `${XHTML_DOCTYPE}\n${out.trimStart()}`;
}

/** Collect editor-facing warnings about the exported document. */
export function lint(doc, html) {
  const warnings = [];
  const s = normalizeSettings(doc.settings);
  doc.blocks.forEach((b, i) => {
    const n = `Block ${i + 1} (${b.type})`;
    const p = b.props;
    if (b.type === 'image' && !p.src) warnings.push(`${n}: no image selected — the block is omitted from the export.`);
    if (b.type === 'image' && p.src && !String(p.alt || '').trim()) warnings.push(`${n}: image is missing alt text.`);
    if (b.type === 'header' && p.logoSrc && !String(p.logoAlt || '').trim()) warnings.push(`${n}: logo is missing alt text.`);
    if (b.type === 'button' && (!p.href || p.href === '#')) warnings.push(`${n}: button has no link.`);
    if (b.type === 'columns2') {
      p.columns?.forEach((c, ci) => {
        if (c?.imageSrc && !String(c.imageAlt || '').trim()) warnings.push(`${n}: column ${ci + 1} image is missing alt text.`);
      });
    }
  });
  if (/\ssrc="\/(?!\/)/.test(html)) {
    warnings.push('Some image URLs are relative. Set "Asset base URL" in Email settings so images load in mail clients.');
  }
  if (/\ssrc="[^"]*\.webp(?:[?#][^"]*)?"/i.test(html)) {
    warnings.push('WebP images do not display in Outlook desktop. Re-upload them (they are converted automatically) or use PNG/JPG.');
  }
  if (/\ssrc="http:\/\/(localhost|127\.0\.0\.1)/.test(html)) {
    warnings.push('Images point at localhost — recipients will not be able to load them. Set a public Asset base URL.');
  }
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > 102 * 1024) warnings.push(`HTML is ${(bytes / 1024).toFixed(1)} KB — Gmail clips messages larger than 102 KB.`);
  if (!s.subject.trim()) warnings.push('No subject/title set in Email settings.');
  return warnings;
}

/**
 * @param {object} rawDoc  editor document JSON
 * @param {{baseUrl?: string}} opts  fallback absolute origin for /uploads paths
 */
export function exportEmail(rawDoc, opts = {}) {
  const doc = normalizeDocument(rawDoc);
  const baseUrl = (doc.settings.assetBaseUrl || opts.baseUrl || '').trim();
  const source = renderEmailDocument(doc, { baseUrl });
  const inlined = juice(source, JUICE_OPTIONS);
  const html = toXhtml(inlined);
  return { html, bytes: Buffer.byteLength(html, 'utf8'), warnings: lint(doc, html) };
}
