/**
 * Media library: sidebar panel, upload handling and the image picker modal.
 * Uploads are stored server-side under YYYY/MM/<ProjectName>/.
 *
 * "This project" shows the current project's images as a grid. "All projects"
 * shows a folder tree (year → month → project) that loads a project's images
 * when it's opened; admins can purge a project, month or year from the tree.
 */
import Sortable from '/vendor/sortablejs/sortable.esm.js';
import { datedProjectDir } from '/shared/paths.js';
import { api } from './api.js';
import { store } from './store.js';
import { session } from './account.js';
import { $, $$, h, toast, copyText, openDialog, ICONS } from './ui.js';

/** Months older than this are flagged in the tree (uploads are kept up to two years). */
const RETENTION_MONTHS = 24;

let files = [];
let scope = 'project';
let pickerScope = 'project';
let pickerResolve = null;
// Folder paths the user has opened, kept across refreshes. null = not set yet.
let openFolders = null;

const projectName = () => store.doc.settings.projectName;
const isAdmin = () => session.user?.role === 'admin';

function absoluteUrl(url) {
  return new URL(url, location.origin).href;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function monthName(mm) {
  return new Date(2000, Number(mm) - 1, 1).toLocaleString(undefined, { month: 'long' });
}

/* ------------------------------------------------------------ thumbnails */

function itemEl(file, { forPicker = false, onDeleted } = {}) {
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
      onclick: () => removeFile(file, onDeleted),
    }),
  );
  fig.append(actions);
  return fig;
}

function fillGrid(grid, list, opts = {}) {
  grid.replaceChildren(
    ...(list.length ? list.map((f) => itemEl(f, opts)) : [h('div', { class: 'app-media-empty' }, opts.empty || 'No images.')]),
  );
}

/** Library thumbnails in the sidebar can be dragged onto the canvas. */
function makeDraggable(grid) {
  Sortable.create(grid, {
    group: { name: 'media', pull: 'clone', put: false },
    sort: false,
    draggable: '.app-media-item',
    filter: '.app-media-actions',
    preventOnFilter: false,
  });
}

async function removeFile(file, onDeleted) {
  if (!confirm(`Delete ${file.path}?\nEmails already sent that reference this image will show a broken image.`)) return;
  try {
    await api.deleteUpload(file.path);
    files = files.filter((f) => f.path !== file.path);
    toast('Image deleted');
    onDeleted ? onDeleted() : refresh();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

/* ----------------------------------------------------------- folder tree */

function defaultOpenFolders() {
  // Open the current project's folder for this month, and its month and year.
  const dir = datedProjectDir(projectName());
  const [y, m] = dir.split('/');
  return new Set([y, `${y}/${m}`, dir]);
}

function treeRow(label, meta, { badge, onDelete, title } = {}) {
  const del =
    onDelete && isAdmin()
      ? h('button', {
          type: 'button',
          class: 'app-icon-btn app-tree-del',
          title: `Delete ${label}…`,
          'aria-label': `Delete ${label}`,
          html: ICONS.trash,
          onclick: (e) => {
            // Don't open/close the folder when the delete button is clicked.
            e.preventDefault();
            e.stopPropagation();
            onDelete();
          },
        })
      : null;
  // Name (and age badge) on the first line, counts underneath, so names aren't squeezed.
  return h(
    'summary',
    { title: title || label },
    h(
      'span',
      { class: 'app-tree-text' },
      h(
        'span',
        { class: 'app-tree-line' },
        h('span', { class: 'app-tree-label' }, label),
        badge ? h('span', { class: 'app-badge app-badge-warn', title: 'Uploaded more than two years ago' }, badge) : null,
      ),
      h('span', { class: 'app-tree-meta' }, meta),
    ),
    del,
  );
}

function folder(path, summary, children, { cls, onOpen } = {}) {
  const el = h('details', { class: `app-tree-node ${cls}`, dataset: { path } }, summary, children);
  if (openFolders.has(path)) el.open = true;
  el.addEventListener('toggle', () => {
    if (el.open) {
      openFolders.add(path);
      onOpen?.();
    } else {
      openFolders.delete(path);
    }
  });
  return el;
}

async function renderTree(container, { forPicker = false } = {}) {
  openFolders ??= defaultOpenFolders();
  container.replaceChildren(h('div', { class: 'app-media-empty' }, 'Loading…'));
  let years;
  try {
    ({ years } = await api.uploadTree());
  } catch (err) {
    container.replaceChildren(h('div', { class: 'app-media-empty' }, `Could not load media: ${err.message}`));
    return;
  }
  if (!years.length) {
    container.replaceChildren(h('div', { class: 'app-media-empty' }, 'No images uploaded yet.'));
    return;
  }
  const current = datedProjectDir(projectName());
  const redraw = () => renderTree(container, { forPicker });

  const projectNode = (p) => {
    const grid = h('div', { class: `app-media-grid${forPicker ? ' app-media-grid-lg' : ''}` });
    const load = async () => {
      grid.replaceChildren(h('div', { class: 'app-media-empty' }, 'Loading…'));
      try {
        const res = await api.listFolder(p.path);
        fillGrid(grid, res.files, { forPicker, empty: 'This folder is empty.', onDeleted: redraw });
        if (!forPicker) makeDraggable(grid);
      } catch (err) {
        grid.replaceChildren(h('div', { class: 'app-media-empty' }, err.message));
      }
    };
    const node = folder(
      p.path,
      treeRow(p.name, `${plural(p.files, 'image')} · ${formatBytes(p.bytes)}`, {
        title: p.path,
        onDelete: forPicker ? null : () => confirmPurge(p.path, 'project', redraw),
      }),
      grid,
      { cls: `app-tree-project${p.path === current ? ' is-current' : ''}`, onOpen: load },
    );
    if (node.open) load();
    return node;
  };

  const monthNode = (m, year) => {
    const old = m.ageMonths >= RETENTION_MONTHS;
    return folder(
      m.path,
      treeRow(monthName(m.month), `${plural(m.files, 'image')} · ${formatBytes(m.bytes)}`, {
        title: `${monthName(m.month)} ${year} (${m.path})`,
        badge: old ? 'Over 2 years' : null,
        onDelete: forPicker ? null : () => confirmPurge(m.path, 'month', redraw),
      }),
      h('div', { class: 'app-tree-children' }, m.projects.map(projectNode)),
      { cls: `app-tree-month${old ? ' is-old' : ''}` },
    );
  };

  container.replaceChildren(
    ...years.map((y) => {
      const allOld = y.months.length && y.months.every((m) => m.ageMonths >= RETENTION_MONTHS);
      return folder(
        y.path,
        treeRow(y.year, `${plural(y.files, 'image')} · ${formatBytes(y.bytes)}`, {
          badge: allOld ? 'Over 2 years' : null,
          onDelete: forPicker ? null : () => confirmPurge(y.path, 'year', redraw),
        }),
        h('div', { class: 'app-tree-children' }, y.months.map((m) => monthNode(m, y.year))),
        { cls: 'app-tree-year' },
      );
    }),
  );
}

/**
 * Confirm and delete a project, month or year folder. Month and year purges
 * ask for the folder name to be typed, since they can remove a lot at once.
 */
async function confirmPurge(path, level, after) {
  let s;
  try {
    s = await api.folderSummary(path);
  } catch (err) {
    toast(err.message, { error: true });
    return;
  }
  const [y, m, p] = path.split('/');
  const name = level === 'project' ? `the project “${p}” (${monthName(m)} ${y})` : level === 'month' ? `${monthName(m)} ${y}` : `all of ${y}`;
  const typed = level !== 'project';
  const input = typed ? h('input', { class: 'app-input', id: 'purge-confirm', autocomplete: 'off', spellcheck: 'false', placeholder: path }) : null;
  const body = h(
    'div',
    { class: 'app-form app-form-dialog' },
    h('p', {}, `This permanently deletes ${plural(s.files, 'image')} (${formatBytes(s.bytes)})`, level !== 'project' ? ` in ${plural(s.projects.length, 'project')}` : '', ` from ${path}/.`),
    level !== 'project' && s.projects.length
      ? h('ul', { class: 'app-purge-list' }, s.projects.slice(0, 12).map((x) => h('li', {}, x.split('/').pop())), s.projects.length > 12 ? h('li', {}, `…and ${s.projects.length - 12} more`) : null)
      : null,
    h('div', { class: 'app-warn' }, 'Emails already sent that show these images will display broken images. This can’t be undone.'),
    s.templates.length
      ? h('div', { class: 'app-warn' }, `Used by ${plural(s.templates.length, 'template')}: ${s.templates.join(', ')}. Their images will also break.`)
      : null,
    typed ? h('div', { class: 'app-field' }, h('label', { for: 'purge-confirm' }, `Type ${path} to confirm`), input) : null,
  );
  openDialog({
    title: `Delete ${name}?`,
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Delete permanently',
        kind: 'danger',
        onClick: async () => {
          if (typed && input.value.trim() !== path) {
            input.focus();
            return false;
          }
          try {
            const res = await api.deleteFolder(path);
            toast(`Deleted ${path}/ (${plural(res.deleted.files, 'image')}, ${formatBytes(res.deleted.bytes)})`, { ms: 4000 });
            for (const f of [...openFolders]) if (f === path || f.startsWith(`${path}/`)) openFolders.delete(f);
            after?.();
            if (scope === 'project') refresh();
          } catch (err) {
            toast(err.message, { error: true });
            return false;
          }
          return true;
        },
      },
    ],
  });
  // Keep the delete button disabled until the folder name has been typed.
  if (typed) {
    const btn = [...document.querySelectorAll('.app-modal-footer .app-btn-danger')].pop();
    const sync = () => (btn.disabled = input.value.trim() !== path);
    input.addEventListener('input', sync);
    sync();
  }
}

/* ------------------------------------------------------------ rendering */

function showScope(gridSel, treeSel, which) {
  $(gridSel).hidden = which !== 'project';
  $(treeSel).hidden = which === 'project';
}

function updateTargetPath() {
  const dir = datedProjectDir(projectName());
  $('#media-target-path').textContent = dir + '/';
  $$('.js-target-path').forEach((n) => (n.textContent = dir + '/'));
}

async function refresh() {
  showScope('#media-grid', '#media-tree', scope);
  if (scope === 'all') {
    await renderTree($('#media-tree'));
  } else {
    try {
      files = (await api.listUploads(projectName())).files;
      fillGrid($('#media-grid'), files, { empty: 'No images for this project yet.' });
    } catch (err) {
      toast(`Could not load media: ${err.message}`, { error: true });
    }
  }
  if (!$('#picker').hidden) refreshPicker();
}

async function refreshPicker() {
  showScope('#picker-grid', '#picker-tree', pickerScope);
  if (pickerScope === 'all') return renderTree($('#picker-tree'), { forPicker: true });
  try {
    const list = (await api.listUploads(projectName())).files;
    fillGrid($('#picker-grid'), list, { forPicker: true, empty: 'No images for this project yet. Upload one above.' });
  } catch (err) {
    toast(`Could not load media: ${err.message}`, { error: true });
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
    $$('input[name="picker-scope"]').forEach((r) =>
      r.addEventListener('change', () => {
        pickerScope = r.value;
        refreshPicker();
      }),
    );

    makeDraggable($('#media-grid'));

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
      // Make sure the folder just uploaded to is open in the tree.
      openFolders?.add(res.directory).add(res.directory.split('/').slice(0, 2).join('/')).add(res.directory.split('/')[0]);
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
    refreshPicker();
    $('#picker .app-modal-card').focus?.();
    return new Promise((resolve) => (pickerResolve = resolve));
  },
};

