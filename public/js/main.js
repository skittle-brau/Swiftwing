import { BLOCK_TYPES, createBlock, createDocument } from '/shared/blocks.js';
import { store } from './store.js';
import { api } from './api.js';
import { $, $$, h, blockIcon, downloadFile, slugify, toast } from './ui.js';
import { initCanvas, renderAll, renderOne, syncSelection, insertBlock, duplicateBlock, deleteBlock } from './canvas.js';
import { initInspector, setServerBaseUrl } from './inspector.js';
import { media } from './media.js';
import { initSource, copyHtml, downloadHtml } from './source.js';
import Sortable from '/vendor/sortablejs/sortable.esm.js';
import { initAccount } from './account.js';
import { initTemplates } from './templates.js';

/* --------------------------------------------------------------- palette */

function buildPalette() {
  for (const group of ['layout', 'content']) {
    const el = $(`.app-palette[data-group="${group}"]`);
    for (const [type, def] of Object.entries(BLOCK_TYPES)) {
      if (def.group !== group) continue;
      const item = h(
        'div',
        { class: 'app-palette-item', role: 'button', tabindex: '0', dataset: { blockType: type }, title: `Add ${def.label}` },
        h('span', { html: blockIcon(def.icon) }),
        def.label,
      );
      const add = () => {
        const i = store.selectedId ? store.indexOf(store.selectedId) + 1 : store.doc.blocks.length;
        insertBlock(createBlock(type), i);
      };
      item.addEventListener('click', add);
      item.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), add()));
      el.append(item);
    }
    Sortable.create(el, { group: { name: 'palette', pull: 'clone', put: false }, sort: false, draggable: '.app-palette-item' });
  }
}

/* ---------------------------------------------------------------- topbar */

function initTopbar() {
  const name = $('#project-name');
  name.value = store.doc.settings.projectName;
  name.addEventListener('input', () =>
    store.update((doc) => { doc.settings.projectName = name.value || 'Untitled Project'; }, { render: 'none', coalesce: 'projectName', source: 'topbar' }),
  );

  $('#btn-undo').addEventListener('click', () => store.undo());
  $('#btn-redo').addEventListener('click', () => store.redo());
  $('#btn-copy').addEventListener('click', copyHtml);
  $('#btn-download').addEventListener('click', downloadHtml);

  const menu = $('#file-menu');
  const btn = $('#btn-menu');
  const setMenu = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) document.dispatchEvent(new CustomEvent('app-menu-open', { detail: menu }));
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMenu(menu.hidden);
  });
  document.addEventListener('click', () => setMenu(false));
  document.addEventListener('app-menu-open', (e) => e.detail !== menu && setMenu(false));
  menu.addEventListener('click', (e) => {
    const action = e.target.closest('[data-file]')?.dataset.file;
    if (action === 'new' && confirm('Start a new email? Unsaved changes can still be undone.')) {
      store.replace(createDocument(store.doc.settings.projectName));
    } else if (action === 'open') {
      $('#open-json').click();
    } else if (action === 'save') {
      downloadFile(`${slugify(store.doc.settings.projectName)}.email.json`, JSON.stringify(store.doc, null, 2), 'application/json');
    }
  });
  $('#open-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const doc = JSON.parse(await file.text());
      if (!Array.isArray(doc.blocks)) throw new Error('Not an Atelier design file.');
      store.replace(doc);
      toast(`Opened ${file.name}`);
    } catch (err) {
      toast(`Could not open file: ${err.message}`, { error: true });
    }
  });
}

function syncTopbar() {
  $('#btn-undo').disabled = !store.past.length;
  $('#btn-redo').disabled = !store.future.length;
  const name = $('#project-name');
  if (document.activeElement !== name) name.value = store.doc.settings.projectName;
  document.title = `${store.doc.settings.projectName} · Atelier Email Builder`;
}

/* -------------------------------------------------------------- shortcuts */

function isTyping(e) {
  const t = e.target;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest?.('.tox');
}

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (isTyping(e)) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
    } else if (mod && e.key.toLowerCase() === 'd' && store.selectedId) {
      e.preventDefault();
      duplicateBlock(store.selectedId);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && store.selectedId) {
      e.preventDefault();
      deleteBlock(store.selectedId);
    } else if (e.key === 'Escape') {
      store.select(null);
    }
  });
}

/* --------------------------------------------------------------- sidebar */

function initSidebarTabs() {
  $$('.app-tabs [data-tab]').forEach((tab) =>
    tab.addEventListener('click', () => {
      $$('.app-tabs [data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      $$('.app-tabpanel').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    }),
  );
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  try {
    await initAccount();
  } catch {
    return; // not logged in: api.js has already redirected to /login
  }
  buildPalette();
  initSidebarTabs();
  initTopbar();
  initCanvas();
  initInspector();
  initSource();
  initShortcuts();
  initTemplates();

  media.onInsert = (file) => {
    const i = store.selectedId ? store.indexOf(store.selectedId) + 1 : store.doc.blocks.length;
    insertBlock(createBlock('image', { src: file.url }), i);
  };
  media.init();

  store.subscribe((evt, opts) => {
    if (evt === 'change') {
      if (opts.render === 'all') renderAll();
      else if (opts.render === 'block') renderOne(opts.id);
      syncTopbar();
    } else if (evt === 'select') {
      syncSelection();
    }
  });

  renderAll();
  syncTopbar();

  try {
    const cfg = await api.config();
    setServerBaseUrl(cfg.publicBaseUrl);
  } catch {
    /* offline — keep defaults */
  }
}

boot();
