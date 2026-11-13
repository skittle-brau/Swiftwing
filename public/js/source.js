/**
 * Export-facing views: real-time HTML source, rendered preview, and the
 * Copy HTML / Download .html actions. All of them use the server export
 * engine (juice-inlined XHTML), so what you see is exactly what you ship.
 */
import { api } from './api.js';
import { store } from './store.js';
import { $, $$, copyText, debounce, downloadFile, slugify, toast } from './ui.js';

let cache = { key: null, result: null };
let currentView = 'visual';

async function getExport() {
  const key = JSON.stringify(store.doc);
  if (cache.key === key && cache.result) return cache.result;
  const result = await api.exportHtml(store.doc);
  cache = { key, result };
  return result;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Lightweight HTML syntax highlighter (no dependencies). */
function highlight(src) {
  const out = [];
  const re = /(<!--[\s\S]*?-->)|(<!DOCTYPE[^>]*>)|(<\/?[a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)(\s*\/?>)/g;
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    out.push(escapeHtml(src.slice(last, m.index)));
    if (m[1]) out.push(`<span class="c">${escapeHtml(m[1])}</span>`);
    else if (m[2]) out.push(`<span class="d">${escapeHtml(m[2])}</span>`);
    else {
      const attrs = m[4].replace(/(\s+)([^\s=]+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+))?/g, (_a, sp, name, eq, val) =>
        `${sp}<span class="a">${escapeHtml(name)}</span>${eq ? escapeHtml(eq) + `<span class="v">${escapeHtml(val)}</span>` : ''}`,
      );
      out.push(`<span class="t">${escapeHtml(m[3])}</span>${attrs}<span class="t">${escapeHtml(m[5])}</span>`);
    }
    last = re.lastIndex;
  }
  out.push(escapeHtml(src.slice(last)));
  return out.join('');
}

async function refreshSource() {
  const meta = $('#source-meta');
  try {
    const { html, bytes, warnings, doctypeLabel, synergetic } = await getExport();
    const code = $('#source-code code');
    code.innerHTML = highlight(html);
    const kb = (bytes / 1024).toFixed(1);
    meta.innerHTML = `${doctypeLabel}${synergetic ? ' · Synergetic compatibility' : ''} · CSS inlined · <b>${kb} KB</b> · ${html.split('\n').length} lines`;
    const list = $('#source-warnings');
    list.hidden = !warnings.length;
    list.replaceChildren(...warnings.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
  } catch (err) {
    meta.textContent = `Export failed: ${err.message}`;
  }
}

async function refreshPreview() {
  try {
    const { html } = await getExport();
    $('#preview-frame').srcdoc = html;
  } catch (err) {
    toast(`Preview failed: ${err.message}`, { error: true });
  }
}

const refreshActive = debounce(() => {
  if (currentView === 'source') refreshSource();
  else if (currentView === 'preview') refreshPreview();
}, 250);

export function setView(view) {
  currentView = view;
  $$('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  $$('[data-view-panel]').forEach((p) => (p.hidden = p.dataset.viewPanel !== view));
  if (view !== 'visual') refreshActive();
}

export async function copyHtml() {
  try {
    const { html, warnings } = await getExport();
    if (await copyText(html)) toast(`HTML copied to clipboard${warnings.length ? ` · ${warnings.length} warning(s) in HTML source view` : ''}`);
    else toast('Copy failed — use the HTML source view.', { error: true });
  } catch (err) {
    toast(`Export failed: ${err.message}`, { error: true });
  }
}

export async function downloadHtml() {
  try {
    const { html } = await getExport();
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`${slugify(store.doc.settings.projectName)}-${date}.html`, html);
  } catch (err) {
    toast(`Export failed: ${err.message}`, { error: true });
  }
}

export function initSource() {
  store.subscribe((evt) => evt === 'change' && refreshActive());
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $$('[data-view-panel="source"] [data-action]').forEach((b) =>
    b.addEventListener('click', () => (b.dataset.action === 'copy' ? copyHtml() : downloadHtml())),
  );
  $('#source-wrap').addEventListener('change', (e) => $('#source-code').classList.toggle('is-wrapped', e.target.checked));
  $$('[data-device]').forEach((b) =>
    b.addEventListener('click', () => {
      $$('[data-device]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      $('.app-preview-wrap').classList.toggle('is-mobile', b.dataset.device === 'mobile');
    }),
  );
}
