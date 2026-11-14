/**
 * Right-hand properties panel: block props for the selected block, or the
 * document-wide email settings when nothing is selected.
 */
import { BLOCK_TYPES, FONT_STACKS, SOCIAL_NETWORKS, getPath, setPath } from '/shared/blocks.js';
import { color as normColor, normalizeCells, DOCTYPES } from '/shared/render.js';

const MAX_TABLE_ROWS = 30;
const MAX_TABLE_COLS = 8;
import { datedProjectDir } from '/shared/paths.js';
import { store } from './store.js';
import { media } from './media.js';
import { fitImageWidth } from './canvas.js';
import { $, h, ICONS, toast } from './ui.js';
import { api } from './api.js';

let serverBaseUrl = '';
export function setServerBaseUrl(url) {
  serverBaseUrl = url;
}

const SETTINGS_FIELDS = [
  { key: 'subject', label: 'Subject / title', type: 'text', help: 'Used for the HTML <title>.' },
  { key: 'preheader', label: 'Preheader text', type: 'text', help: 'Hidden preview text shown after the subject in most inboxes.' },
  { type: 'divider' },
  {
    key: 'fullWidth',
    label: 'Full width (100%)',
    type: 'checkbox',
    help: 'Fill the reader’s window like a normal email, instead of a centred fixed-width layout. Images keep their pixel sizes.',
  },
  {
    key: 'width',
    label: 'Email width',
    type: 'number',
    min: 320,
    max: 800,
    suffix: 'px',
    help: 'In full-width mode this sets the size of full-width images and column images instead.',
  },
  { key: 'fontFamily', label: 'Font family', type: 'select', options: FONT_STACKS.map((f) => [f.value, f.label]) },
  { row: [
    { key: 'fontSize', label: 'Body size', type: 'number', min: 10, max: 24, suffix: 'px' },
    { key: 'lineHeight', label: 'Line height', type: 'number', min: 12, max: 40, suffix: 'px' },
  ] },
  { key: 'bodyBg', label: 'Page background', type: 'color' },
  { key: 'contentBg', label: 'Content background', type: 'color' },
  { key: 'textColor', label: 'Text colour', type: 'color' },
  { key: 'headingColor', label: 'Heading colour', type: 'color' },
  { key: 'linkColor', label: 'Link colour', type: 'color' },
  { type: 'divider' },
  {
    key: 'assetBaseUrl',
    label: 'Asset base URL',
    type: 'url',
    help: 'Prefix for uploaded images in the exported HTML. Must be publicly reachable by recipients. Leave blank to use this server.',
  },
  { type: 'heading', label: 'Export' },
  {
    key: 'doctype',
    label: 'Doctype',
    type: 'select',
    options: Object.entries(DOCTYPES).map(([k, d]) => [k, d.label]),
    help: 'The HTML version of the exported email. HTML 4.01 Transitional suits most mailers; XHTML writes self-closing tags (<br />).',
  },
  {
    key: 'strictXhtml',
    label: 'Strict validation',
    type: 'checkbox',
    help: 'Leaves out markup the chosen doctype doesn’t define: role="presentation" (except in HTML5) and the Outlook VML/Office namespaces.',
  },
];

/* ------------------------------------------------------------ field kinds */

function wrap(field, control) {
  return h(
    'div',
    { class: 'app-field' },
    field.type === 'checkbox' ? null : h('label', { for: `f-${field.key}` }, field.label),
    control,
    field.help ? h('small', {}, field.help) : null,
  );
}

function controlFor(field, value, commit, getLive = () => value) {
  const id = `f-${field.key}`;
  switch (field.type) {
    case 'number': {
      const input = h('input', { id, class: 'app-input', type: 'number', min: field.min, max: field.max, step: 1 });
      input.value = value ?? 0;
      input.addEventListener('input', () => input.value !== '' && commit(Number(input.value)));
      return h('div', { class: 'app-input-suffix', 'data-suffix': field.suffix || '' }, input);
    }
    case 'select': {
      const sel = h('select', { id }, field.options.map(([v, l]) => h('option', { value: v }, l)));
      sel.value = value;
      sel.addEventListener('change', () => commit(sel.value));
      return sel;
    }
    case 'checkbox': {
      const cb = h('input', { id, type: 'checkbox' });
      cb.checked = !!value;
      cb.addEventListener('change', () => commit(cb.checked));
      return h('label', { class: 'app-checkbox', for: id }, cb, field.label);
    }
    case 'color': {
      const hex = normColor(value);
      const picker = h('input', { type: 'color', 'aria-label': field.label });
      picker.value = hex || '#ffffff';
      const text = h('input', { id, class: 'app-input', type: 'text', placeholder: field.allowEmpty ? 'None' : '#000000', maxlength: 7, spellcheck: 'false' });
      text.value = hex;
      picker.addEventListener('input', () => {
        text.value = picker.value;
        commit(picker.value);
      });
      text.addEventListener('input', () => {
        const v = normColor(text.value);
        if (v) {
          picker.value = v;
          commit(v);
        } else if (!text.value && field.allowEmpty) commit('');
      });
      const clear = field.allowEmpty
        ? h('button', { type: 'button', class: 'app-icon-btn', title: 'Clear', 'aria-label': 'Clear colour', html: ICONS.x, onclick: () => { text.value = ''; commit(''); } })
        : null;
      return h('div', { class: 'app-color' }, picker, text, clear);
    }
    case 'code': {
      const ta = h('textarea', { id, spellcheck: 'false' });
      ta.value = value ?? '';
      ta.addEventListener('input', () => commit(ta.value));
      return ta;
    }
    case 'image': {
      const thumb = h('div', { class: 'app-image-thumb' }, value ? '' : 'No image');
      if (value) thumb.style.backgroundImage = `url("${value.replace(/["\\\n]/g, encodeURIComponent)}")`;
      const url = h('input', { id, class: 'app-input', type: 'text', placeholder: 'https://… or choose from library' });
      url.value = value || '';
      url.addEventListener('change', () => commit(url.value.trim(), { rerenderInspector: true }));
      const choose = h('button', {
        type: 'button',
        class: 'app-btn app-btn-sm',
        onclick: async () => {
          const f = await media.pick();
          if (f) commit(f.url, { rerenderInspector: true, image: f });
        },
      }, 'Choose / upload…');
      const remove = value
        ? h('button', { type: 'button', class: 'app-btn app-btn-sm app-btn-danger', onclick: () => commit('', { rerenderInspector: true }) }, 'Remove')
        : null;
      return h('div', { class: 'app-image-field' }, thumb, h('div', { class: 'app-image-buttons' }, choose, remove), url);
    }
    case 'tablesize': {
      const rows = normalizeCells(value);
      const make = (label, n, min, max) => {
        const input = h('input', { class: 'app-input', type: 'number', min, max, step: 1, 'aria-label': label });
        input.value = n;
        return input;
      };
      const r = make('Rows', rows.length, 1, MAX_TABLE_ROWS);
      const c = make('Columns', rows[0].length, 1, MAX_TABLE_COLS);
      const apply = () => {
        const nr = Math.min(MAX_TABLE_ROWS, Math.max(1, Math.round(Number(r.value) || 1)));
        const nc = Math.min(MAX_TABLE_COLS, Math.max(1, Math.round(Number(c.value) || 1)));
        // Keep existing cell contents; new cells start empty.
        const next = Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[i]?.[j] ?? ''));
        const lost = rows.some((row, i) => row.some((cell, j) => (i >= nr || j >= nc) && cell.replace(/<[^>]*>|&nbsp;|\s/g, '')));
        if (lost && !confirm('Removing these rows or columns deletes the text in them. Continue?')) {
          r.value = rows.length;
          c.value = rows[0].length;
          return;
        }
        commit(next, { rerenderInspector: true });
      };
      r.addEventListener('change', apply);
      c.addEventListener('change', apply);
      return h(
        'div',
        { class: 'app-row2' },
        h('div', { class: 'app-input-suffix', 'data-suffix': 'rows' }, r),
        h('div', { class: 'app-input-suffix', 'data-suffix': 'cols' }, c),
      );
    }
    case 'list':
      return listEditor(field, Array.isArray(value) ? value : [], commit, getLive);
    case 'social':
      return socialEditor(value || [], commit);
    case 'video': {
      const input = h('input', { id, class: 'app-input', type: 'url', placeholder: 'https://www.youtube.com/watch?v=…', spellcheck: 'false' });
      input.value = value || '';
      const status = h('small', { class: 'app-video-status', role: 'status' });
      const setStatus = (msg, isError = false) => {
        status.textContent = msg;
        status.classList.toggle('is-error', isError);
      };
      let last = input.value.trim();
      const go = (force = false) => {
        const v = input.value.trim();
        if (!v || (!force && v === last)) return;
        last = v;
        commit(v, { fetchVideo: true, setStatus, button });
      };
      const button = h('button', { type: 'button', class: 'app-btn app-btn-sm', onclick: () => go(true) }, value ? 'Refresh thumbnail' : 'Get thumbnail');
      input.addEventListener('paste', () => setTimeout(() => go(), 0));
      input.addEventListener('change', () => go());
      input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), go(true)));
      return h('div', { class: 'app-image-field' }, input, h('div', { class: 'app-image-buttons' }, button), status);
    }
    case 'url':
    case 'text':
    default: {
      const input = h('input', { id, class: 'app-input', type: 'text', spellcheck: field.type === 'url' ? 'false' : 'true' });
      if (field.type === 'url') input.placeholder = field.key === 'assetBaseUrl' ? serverBaseUrl || 'https://' : 'https://';
      input.value = value ?? '';
      input.addEventListener('input', () => commit(input.value));
      return input;
    }
  }
}

/**
 * Editable list of items (images in a group, cards…). Each item's fields reuse
 * the normal controls; adding, removing and reordering commit the whole array.
 */
function listEditor(field, items, commit, getLive) {
  // Apply each change to the latest items (canvas edits may have changed them
  // since this panel was drawn), then commit the whole list.
  const change = (fn, rerender = false) => {
    const live = (Array.isArray(getLive()) ? getLive() : items).map((it) => ({ ...it }));
    fn(live);
    commit(live, { rerenderInspector: rerender });
  };
  const list = items;
  const wrapEl = h('div', { class: 'app-list' });
  list.forEach((item, i) => {
    const head = h(
      'div',
      { class: 'app-list-head' },
      h('strong', {}, `${field.itemLabel || 'Item'} ${i + 1}`),
      h(
        'span',
        {},
        h('button', { type: 'button', class: 'app-icon-btn', title: 'Move up', 'aria-label': 'Move up', html: ICONS.up, disabled: i === 0, onclick: () => change((l) => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; }, true) }),
        h('button', { type: 'button', class: 'app-icon-btn', title: 'Move down', 'aria-label': 'Move down', html: ICONS.down, disabled: i === list.length - 1, onclick: () => change((l) => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; }, true) }),
        h('button', { type: 'button', class: 'app-icon-btn', title: 'Remove', 'aria-label': `Remove ${field.itemLabel || 'item'} ${i + 1}`, html: ICONS.trash, disabled: list.length <= 1, onclick: () => change((l) => { l.splice(i, 1); }, true) }),
      ),
    );
    const box = h('div', { class: 'app-list-item' }, head);
    for (const sub of field.itemFields) {
      const subField = { ...sub, key: `${field.key}.${i}.${sub.key}` };
      const commitSub = (v, extra = {}) => change((l) => { if (l[i]) l[i][sub.key] = v; }, !!extra.rerenderInspector);
      box.append(wrap(subField, controlFor(subField, item[sub.key], commitSub)));
    }
    wrapEl.append(box);
  });
  if (list.length < (field.max || 12)) {
    wrapEl.append(
      h('button', { type: 'button', class: 'app-btn app-btn-sm', onclick: () => change((l) => { l.push(field.newItem()); }, true) }, `+ Add ${(field.itemLabel || 'item').toLowerCase()}`),
    );
  }
  return wrapEl;
}

function socialEditor(items, commit) {
  const listEl = h('div', { class: 'app-social-list' });
  const draw = () => {
    listEl.replaceChildren(
      ...items.map((item, i) => {
        const sel = h('select', { 'aria-label': 'Network' }, Object.entries(SOCIAL_NETWORKS).map(([k, n]) => h('option', { value: k }, n.label)));
        sel.value = item.network;
        sel.addEventListener('change', () => { items[i] = { ...items[i], network: sel.value }; commit([...items]); });
        const del = h('button', { type: 'button', class: 'app-icon-btn', title: 'Remove', 'aria-label': 'Remove link', html: ICONS.trash, onclick: () => { items.splice(i, 1); commit([...items], { rerenderInspector: true }); } });
        const url = h('input', { class: 'app-input', type: 'text', placeholder: 'https://', 'aria-label': 'Link URL' });
        url.value = item.url || '';
        url.addEventListener('input', () => { items[i] = { ...items[i], url: url.value }; commit([...items]); });
        const icon = h('input', { class: 'app-input', type: 'text', placeholder: 'Custom icon URL (optional, PNG)', 'aria-label': 'Icon URL' });
        icon.value = item.iconSrc || '';
        icon.addEventListener('input', () => { items[i] = { ...items[i], iconSrc: icon.value.trim() }; commit([...items]); });
        return h('div', { class: 'app-social-item' }, sel, del, url, icon);
      }),
      h('button', {
        type: 'button',
        class: 'app-btn app-btn-sm',
        onclick: () => { items.push({ network: 'website', url: 'https://', iconSrc: '' }); commit([...items], { rerenderInspector: true }); },
      }, '+ Add link'),
    );
  };
  items = items.map((i) => ({ ...i }));
  draw();
  return listEl;
}

/* ----------------------------------------------------------------- render */

function renderFields(form, fields, getValue, onCommit) {
  for (const field of fields) {
    // Fields that only apply to one choice of another field, e.g. pixel widths for "Fixed pixel widths".
    if (field.showIf) {
      const [key, want] = field.showIf;
      const v = String(getValue(key));
      if (Array.isArray(want) ? !want.includes(v) : v !== want) continue;
    }
    if (field.type === 'divider') {
      form.append(h('div', { class: 'app-divider' }));
      continue;
    }
    if (field.type === 'heading') {
      form.append(h('h3', { class: 'app-section-title app-form-heading' }, field.label));
      continue;
    }
    if (field.row) {
      const row = h('div', { class: 'app-row2' });
      renderFields(row, field.row, getValue, onCommit);
      form.append(row);
      continue;
    }
    const commit = (v, extra = {}) => onCommit(field, v, extra);
    form.append(wrap(field, controlFor(field, getValue(field.key), commit, () => getValue(field.key))));
  }
}

const autoTitles = new Map(); // blockId → title we filled in, so a user's own alt text isn't overwritten

/** Ask the server for a play-button thumbnail and fill in the Video block. */
async function fetchVideo(blockId, url, { setStatus = (m, e) => e && toast(m, { error: true }), button } = {}) {
  const block = store.getBlock(blockId);
  if (!block) return;
  setStatus('Getting the video thumbnail…');
  if (button) button.disabled = true;
  try {
    const res = await api.videoThumbnail(url, store.doc.settings.projectName, block.props.playStyle);
    const cur = store.getBlock(blockId);
    if (!cur) return;
    const keepTitle = cur.props.title && cur.props.title !== autoTitles.get(blockId);
    store.update((doc) => {
      const b = doc.blocks.find((x) => x.id === blockId);
      if (!b) return;
      b.props.url = res.url;
      b.props.thumbnailSrc = res.thumbnail.url;
      if (!keepTitle) b.props.title = res.title;
    }, { render: 'block', id: blockId });
    if (!keepTitle) autoTitles.set(blockId, res.title);
    media.refresh();
    if (store.selectedId === blockId) renderInspector();
    toast(`${res.provider === 'youtube' ? 'YouTube' : 'Vimeo'} thumbnail added${res.title ? `: ${res.title}` : ''}`);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

export function renderInspector() {
  const form = $('#inspector-form');
  const block = store.selectedId ? store.getBlock(store.selectedId) : null;
  form.replaceChildren();

  if (!block) {
    $('#inspector-title').textContent = 'Email settings';
    $('#inspector-back').hidden = true;
    const s = store.doc.settings;
    renderFields(
      form,
      SETTINGS_FIELDS,
      (k) => s[k],
      (field, v) => store.update((doc) => { doc.settings[field.key] = v; }, { render: 'all', coalesce: `settings:${field.key}`, source: 'inspector' }),
    );
    form.append(
      h('div', { class: 'app-info', html: `Images for this project upload to<br><code>uploads/${datedProjectDir(s.projectName)}/</code>` }),
    );
    return;
  }

  const def = BLOCK_TYPES[block.type];
  $('#inspector-title').textContent = def.label;
  $('#inspector-back').hidden = false;
  renderFields(
    form,
    def.fields,
    (k) => getPath(block.props, k),
    (field, v, extra) => {
      // A pasted video link is only saved once its thumbnail has been fetched,
      // so a bad link never replaces a working one.
      if (extra.fetchVideo) return void fetchVideo(block.id, v, extra);
      store.update((doc) => {
        const b = doc.blocks.find((x) => x.id === block.id);
        if (b) setPath(b.props, field.key, v);
      }, { render: 'block', id: block.id, coalesce: `${block.id}:${field.key}`, source: 'inspector' });
      if (block.type === 'image' && field.key === 'src' && v) fitImageWidth(block.id);
      // Show or hide fields that depend on this one.
      if (def.fields.some((f) => f.showIf?.[0] === field.key)) {
        renderInspector();
        return;
      }
      if (block.type === 'video' && field.key === 'playStyle' && block.props.url) fetchVideo(block.id, block.props.url, {});
      if (extra.rerenderInspector) renderInspector();
    },
  );
  if (['text', 'header', 'footer', 'columns2', 'table', 'imageCard', 'imageText', 'boxedText'].includes(block.type)) {
    form.prepend(h('div', { class: 'app-info' }, 'Click the text in the canvas to edit it with the rich-text toolbar.'));
  }
}

export function initInspector() {
  $('#inspector-back').addEventListener('click', () => store.select(null));
  store.subscribe((evt, opts) => {
    if (evt === 'select') renderInspector();
    // Refresh after undo/redo/structural changes, but not while the user is typing in the inspector.
    else if (evt === 'change' && opts.source !== 'inspector' && opts.render !== 'none') renderInspector();
  });
  renderInspector();
}
