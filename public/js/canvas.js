/**
 * Visual drag-and-drop canvas.
 *
 * Renders each block with the shared email renderer (so the canvas matches
 * the export), wraps it with selection chrome and wires up SortableJS for
 * reordering plus drops from the block palette and media library.
 */
import Sortable from '/vendor/sortablejs/sortable.esm.js';
import { BLOCK_TYPES, createBlock, cloneBlock, setPath } from '/shared/blocks.js';
import { renderBlock, makeContext, buildCss } from '/shared/render.js';
import { store } from './store.js';
import { $, ICONS, sanitizeForCanvas, toast } from './ui.js';
import * as rte from './rte.js';
import { media } from './media.js';

const list = () => $('#canvas-list');

function ctx() {
  return makeContext(store.doc, { editable: true, baseUrl: '', sanitizeRaw: sanitizeForCanvas });
}

function blockShell(block, context) {
  const def = BLOCK_TYPES[block.type];
  const sel = block.id === store.selectedId ? ' is-selected' : '';
  return (
    `<div class="app-block${sel}" data-id="${block.id}" data-type="${block.type}">` +
    `<div class="app-block-bar" role="toolbar" aria-label="${def.label} block">` +
    `<span class="app-block-handle" title="Drag to reorder" aria-hidden="true">${ICONS.grip}</span>` +
    `<span class="app-block-name">${def.label}</span>` +
    `<button type="button" data-act="up" title="Move up" aria-label="Move up">${ICONS.up}</button>` +
    `<button type="button" data-act="down" title="Move down" aria-label="Move down">${ICONS.down}</button>` +
    `<button type="button" data-act="dup" title="Duplicate (Ctrl+D)" aria-label="Duplicate">${ICONS.copy}</button>` +
    `<button type="button" data-act="del" title="Delete (Del)" aria-label="Delete">${ICONS.trash}</button>` +
    `</div>` +
    `<div class="app-block-body">${renderBlock(block, context)}</div>` +
    `</div>`
  );
}

function applyFrame() {
  const s = ctx().settings;
  $('#canvas').style.width = s.width + 'px';
  $('#canvas').style.backgroundColor = s.contentBg;
  $('#canvas-bg').style.backgroundColor = s.bodyBg;
  $('#email-css').textContent = buildCss(store.doc, { includeResets: false }).replace(/@media[\s\S]*$/, '');
  $('#canvas-empty').hidden = store.doc.blocks.length > 0;
}

export function renderAll() {
  rte.destroyWithin(null);
  const c = ctx();
  list().innerHTML = store.doc.blocks.map((b) => blockShell(b, c)).join('');
  applyFrame();
  enableInlineText();
}

export function renderOne(id) {
  const block = store.getBlock(id);
  const el = list().querySelector(`.app-block[data-id="${id}"]`);
  if (!block || !el) return renderAll();
  rte.destroyWithin(el);
  const tmp = document.createElement('div');
  tmp.innerHTML = blockShell(block, ctx());
  el.replaceWith(tmp.firstElementChild);
  applyFrame();
  enableInlineText();
}

export function syncSelection() {
  for (const el of list().children) el.classList.toggle('is-selected', el.dataset.id === store.selectedId);
  enableInlineText();
}

/** Plain-text contenteditable for button labels on the selected block. */
function enableInlineText() {
  for (const el of list().querySelectorAll('[data-ae-text]')) {
    const on = el.closest('.app-block')?.dataset.id === store.selectedId;
    if (on) el.setAttribute('contenteditable', 'true');
    else el.removeAttribute('contenteditable');
  }
}

/* --------------------------------------------------------------- actions */

/**
 * Image blocks default to full width; if the image is narrower than the row,
 * use its natural width instead so small graphics aren't upscaled.
 */
export function fitImageWidth(blockId) {
  const b = store.getBlock(blockId);
  if (!b || b.type !== 'image' || !b.props.src) return;
  const img = new Image();
  img.onload = () => {
    const cur = store.getBlock(blockId);
    if (!cur || cur.props.src !== b.props.src) return;
    const max = store.doc.settings.width - (cur.props.paddingX || 0) * 2;
    const w = img.naturalWidth >= max ? 0 : img.naturalWidth;
    if (!img.naturalWidth || cur.props.width === w) return;
    cur.props.width = w;
    store.persist();
    store.emit('change', { render: 'block', id: blockId });
  };
  img.src = b.props.src;
}

export function insertBlock(block, index = store.doc.blocks.length) {
  store.update((doc) => doc.blocks.splice(index, 0, block));
  store.select(block.id);
  if (block.type === 'image' && block.props.src && !block.props.width) fitImageWidth(block.id);
  requestAnimationFrame(() => {
    list().querySelector(`.app-block[data-id="${block.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

export function moveBlock(id, delta) {
  const i = store.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= store.doc.blocks.length) return;
  store.update((doc) => {
    const [b] = doc.blocks.splice(i, 1);
    doc.blocks.splice(j, 0, b);
  });
}

export function duplicateBlock(id) {
  const i = store.indexOf(id);
  if (i < 0) return;
  const copy = cloneBlock(store.doc.blocks[i]);
  insertBlock(copy, i + 1);
}

export function deleteBlock(id) {
  const i = store.indexOf(id);
  if (i < 0) return;
  store.update((doc) => doc.blocks.splice(i, 1));
  const next = store.doc.blocks[Math.min(i, store.doc.blocks.length - 1)];
  store.select(next ? next.id : null);
  toast('Block deleted — Ctrl+Z to undo');
}

async function chooseImageFor(blockId, path) {
  const file = await media.pick();
  if (file) applyImage(blockId, path, file.url);
}

function applyImage(blockId, path, url) {
  store.update((doc) => {
    const b = doc.blocks.find((x) => x.id === blockId);
    if (b) setPath(b.props, path, url);
  }, { render: 'block', id: blockId });
  store.select(blockId);
  if (path === 'src') fitImageWidth(blockId);
}

/* ---------------------------------------------------------------- wiring */

export function initCanvas() {
  const root = list();

  Sortable.create(root, {
    group: { name: 'canvas', pull: false, put: ['palette', 'media'] },
    handle: '.app-block-handle',
    draggable: '.app-block, .app-palette-item, .app-media-item',
    animation: 160,
    ghostClass: 'app-block-ghost',
    emptyInsertThreshold: 40,
    onStart: () => rte.destroyWithin(null),
    onAdd(evt) {
      const item = evt.item;
      const { blockType, src } = item.dataset;
      item.remove();
      if (!blockType || !BLOCK_TYPES[blockType]) return;
      const block = createBlock(blockType, src ? { src, alt: '' } : {});
      insertBlock(block, evt.newIndex);
    },
    onUpdate(evt) {
      const { oldIndex, newIndex } = evt;
      store.update((doc) => {
        const [b] = doc.blocks.splice(oldIndex, 1);
        doc.blocks.splice(newIndex, 0, b);
      });
    },
  });

  root.addEventListener('click', (e) => {
    const blockEl = e.target.closest('.app-block');
    if (!blockEl) return;
    const id = blockEl.dataset.id;

    // Never follow links while editing.
    if (e.target.closest('a')) e.preventDefault();

    const act = e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      ({ up: () => moveBlock(id, -1), down: () => moveBlock(id, 1), dup: () => duplicateBlock(id), del: () => deleteBlock(id) })[
        act.dataset.act
      ]();
      return;
    }

    store.select(id);

    const ph = e.target.closest('[data-ae-image]');
    if (ph) return void chooseImageFor(id, ph.dataset.aeImage);

    const region = e.target.closest('[data-ae-edit]');
    if (region) {
      const path = region.dataset.aeEdit;
      rte.activate(region, {
        point: { x: e.clientX, y: e.clientY },
        onChange(html) {
          store.update((doc) => {
            const b = doc.blocks.find((x) => x.id === id);
            if (b) setPath(b.props, path, html);
          }, { render: 'none', coalesce: `${id}:${path}` });
        },
      });
    }
  });

  root.addEventListener('dblclick', (e) => {
    const img = e.target.closest('.app-block img');
    if (!img) return;
    const blockEl = img.closest('.app-block');
    const block = store.getBlock(blockEl.dataset.id);
    const path = { image: 'src', header: 'logoSrc' }[block.type];
    if (path) chooseImageFor(block.id, path);
    else if (block.type === 'columns2') {
      const col = img.closest('.ae-col');
      const idx = [...blockEl.querySelectorAll('.ae-col')].indexOf(col);
      if (idx >= 0) chooseImageFor(block.id, `columns.${idx}.imageSrc`);
    }
  });

  // Inline plain-text editing (button labels).
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-ae-text]');
    if (!el) return;
    const id = el.closest('.app-block').dataset.id;
    const key = el.dataset.aeText;
    store.update((doc) => {
      const b = doc.blocks.find((x) => x.id === id);
      if (b) setPath(b.props, key, el.textContent.replace(/\s+/g, ' ').trim());
    }, { render: 'none', coalesce: `${id}:${key}`, source: 'canvas' });
  });
  root.addEventListener('keydown', (e) => {
    if (e.target.closest?.('[data-ae-text]') && e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  });
  root.addEventListener('paste', (e) => {
    const el = e.target.closest?.('[data-ae-text]');
    if (!el) return;
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });

  // Deselect by clicking the canvas background.
  $('#canvas-bg').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) store.select(null);
  });

  initFileDrops();
}

/** Desktop files: drop on a placeholder to fill it, or anywhere else to add Image blocks. */
function initFileDrops() {
  const scroll = $('#canvas-scroll');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  let depth = 0;

  scroll.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    scroll.classList.add('is-file-over');
  });
  scroll.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) {
      depth = 0;
      scroll.classList.remove('is-file-over');
    }
  });
  scroll.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    scroll.querySelectorAll('.app-img-placeholder.is-over').forEach((n) => n.classList.remove('is-over'));
    e.target.closest?.('[data-ae-image]')?.classList.add('is-over');
  });
  scroll.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    scroll.classList.remove('is-file-over');
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return toast('Only image files can be dropped here.', { error: true });

    const ph = e.target.closest('[data-ae-image]');
    const blockEl = e.target.closest('.app-block');
    const uploaded = await media.upload(files);
    if (!uploaded.length) return;

    if (ph && blockEl) {
      applyImage(blockEl.dataset.id, ph.dataset.aeImage, uploaded[0].url);
      return;
    }
    let index = store.doc.blocks.length;
    if (blockEl) {
      const rect = blockEl.getBoundingClientRect();
      index = store.indexOf(blockEl.dataset.id) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
    }
    uploaded.forEach((f, k) => insertBlock(createBlock('image', { src: f.url }), index + k));
  });
}
