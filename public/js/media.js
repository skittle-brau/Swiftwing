/**
 * Media library: sidebar panel, upload handling and the image picker modal.
 * Uploads are stored server-side under YYYY/MM/<ProjectName>/.
 */
import Sortable from '/vendor/sortablejs/sortable.esm.js';
import { datedProjectDir } from '/shared/paths.js';
import { api } from './api.js';
import { store } from './store.js';
import { $, $$, h, toast, copyText, ICONS } from './ui.js';

let files = [];
let scope = 'project';
let pickerResolve = null;

const projectName = () => store.doc.settings.projectName;

function absoluteUrl(url) {
  return new URL(url, location.origin).href;
}

function itemEl(file, { forPicker = false } = {}) {
  const fig = h(
    'figure',
    {
      class: 'app-media-item',
      tabindex: '0',
      title: file.path,
      dataset: { blockType: 'image', src: file.url, path: file.path },
    },
    h('img', { src: file.url, alt: file.name, loading: 'lazy', draggable: 'false' }),
    h('figcaption', {}, file.name),
  );
  fig.style.margin = '0';
  if (forPicker) {
    fig.addEventListener('click', () => closePicker(file));
    fig.addEventListener('keydown', (e) => e.key === 'Enter' && closePicker(file));
    return fig;
  }
  const actions = h(
    'div',
    { class: 'app-media-actions' },
    h('button', { type: 'button', title: 'Insert as Image block', 'aria-label': 'Insert', html: ICONS.plus, onclick: () => media.onInsert?.(file) }),
    h('button', {
      type: 'button',
      title: 'Copy URL',
      'aria-label': 'Copy URL',
      html: ICONS.link,
      onclick: async () => (await copyText(absoluteUrl(file.url))) && toast('Image URL copied'),
    }),
    h('button', {
      type: 'button',
      title: 'Delete file',
      'aria-label': 'Delete',
      html: ICONS.trash,
      onclick: () => remove(file),
    }),
  );
  fig.append(actions);
  return fig;
}

function renderGrid(grid, opts) {
  grid.replaceChildren(
    ...(files.length
      ? files.map((f) => itemEl(f, opts))
      : [h('div', { class: 'app-media-empty' }, scope === 'project' ? 'No images for this project yet.' : 'No images uploaded yet.')]),
  );
}

function renderAll() {
  renderGrid($('#media-grid'));
  if (!$('#picker').hidden) renderGrid($('#picker-grid'), { forPicker: true });
}

function updateTargetPath() {
  const dir = datedProjectDir(projectName());
  $('#media-target-path').textContent = dir + '/';
  $$('.js-target-path').forEach((n) => (n.textContent = dir + '/'));
}

async function refresh() {
  try {
    const res = await api.listUploads(scope === 'project' ? projectName() : '');
    files = res.files;
    renderAll();
  } catch (err) {
    toast(`Could not load media: ${err.message}`, { error: true });
  }
}

async function remove(file) {
  if (!confirm(`Delete ${file.path}?\nEmails already sent that reference this image will show a broken image.`)) return;
  try {
    await api.deleteUpload(file.path);
    files = files.filter((f) => f.path !== file.path);
    renderAll();
    toast('Image deleted');
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function bindDropzone(zone, input, onFiles) {
  input.addEventListener('change', () => {
    if (input.files.length) onFiles([...input.files]);
    input.value = '';
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-over');
    const list = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (list.length) onFiles(list);
  });
}

function formatBytes(n) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** "Uploaded 2 images to 2026/11/Project/ · 1 resized to 1200px · 8.4 MB → 610 KB" */
function uploadSummary(res) {
  const n = res.files.length;
  const parts = [`Uploaded ${n} image${n === 1 ? '' : 's'} to ${res.directory}/`];
  const resized = res.files.filter((f) => f.optimized?.resized).length;
  const converted = res.files.filter((f) => f.optimized?.converted).length;
  if (resized) parts.push(`${n > 1 ? `${resized} ` : ''}resized to ${res.maxWidth}px wide`);
  if (converted) parts.push(`${n > 1 ? `${converted} ` : ''}converted from WebP for Outlook`);
  const before = res.files.reduce((a, f) => a + (f.optimized?.originalBytes || f.size), 0);
  const after = res.files.reduce((a, f) => a + f.size, 0);
  if (after < before * 0.95) parts.push(`${formatBytes(before)} → ${formatBytes(after)}`);
  return parts.join(' · ');
}

function closePicker(file = null) {
  $('#picker').hidden = true;
  const r = pickerResolve;
  pickerResolve = null;
  r?.(file);
}

export const media = {
  /** Set by main.js: insert an Image block for a library file. */
  onInsert: null,

  init() {
    updateTargetPath();
    bindDropzone($('#media-dropzone'), $('#media-input'), (f) => media.upload(f));
    bindDropzone($('#picker-dropzone'), $('#picker-input'), async (f) => {
      const up = await media.upload(f);
      if (up.length) closePicker(up[0]);
    });

    $$('input[name="media-scope"]').forEach((r) =>
      r.addEventListener('change', () => {
        scope = r.value;
        refresh();
      }),
    );

    Sortable.create($('#media-grid'), {
      group: { name: 'media', pull: 'clone', put: false },
      sort: false,
      draggable: '.app-media-item',
      filter: '.app-media-actions',
      preventOnFilter: false,
    });

    $('#picker').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closePicker(null);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#picker').hidden) closePicker(null);
    });

    let lastProject = projectName();
    store.subscribe((evt) => {
      if (evt !== 'change' || projectName() === lastProject) return;
      lastProject = projectName();
      updateTargetPath();
      if (scope === 'project') refresh();
    });
    refresh();
  },

  refresh,

  /** Upload files into YYYY/MM/<Project>/ and return their descriptors. */
  async upload(fileList) {
    const zones = $$('.app-dropzone');
    zones.forEach((z) => z.classList.add('is-busy'));
    try {
      const res = await api.upload(fileList, projectName());
      toast(uploadSummary(res), { ms: 4500 });
      await refresh();
      return res.files;
    } catch (err) {
      toast(`Upload failed: ${err.message}`, { error: true, ms: 4000 });
      return [];
    } finally {
      zones.forEach((z) => z.classList.remove('is-busy'));
    }
  },

  /** Open the picker modal; resolves with a file descriptor or null. */
  pick() {
    if (pickerResolve) closePicker(null);
    updateTargetPath();
    $('#picker').hidden = false;
    renderGrid($('#picker-grid'), { forPicker: true });
    refresh();
    $('#picker .app-modal-card').focus?.();
    return new Promise((resolve) => (pickerResolve = resolve));
  },
};
