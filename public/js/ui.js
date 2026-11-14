export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * Move a localStorage value to a new key (used when the app was renamed from
 * Atelier to Swiftwing) so nobody loses an autosaved draft.
 */
export function migrateStorageKey(oldKey, newKey) {
  try {
    const old = localStorage.getItem(oldKey);
    if (old === null) return;
    if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, old);
    localStorage.removeItem(oldKey);
  } catch {
    /* storage unavailable: nothing to migrate */
  }
}
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export function toast(message, { error = false, ms = 2600 } = {}) {
  const el = h('div', { class: `app-toast${error ? ' is-error' : ''}`, role: error ? 'alert' : 'status' }, message);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function downloadFile(name, content, type = 'text/html;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(s) {
  return (
    String(s || 'email')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'email'
  );
}

/** Strip script-capable content before showing user HTML inside the editor page. */
export function sanitizeForCanvas(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,link,meta,base,form').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

const ICON_PATHS = {
  header: '<rect x="3" y="3" width="26" height="20" rx="2"/><rect x="3" y="3" width="26" height="8" rx="2" fill="currentColor" stroke="none" opacity=".25"/><path d="M8 7h8"/><path d="M7 15h18M7 19h12"/>',
  col1: '<rect x="3" y="3" width="26" height="20" rx="2"/><path d="M7 8h18M7 12h18M7 16h18M7 20h10" stroke-width="1.3"/>',
  col2: '<rect x="3" y="3" width="26" height="20" rx="2"/><path d="M16 3v20"/><path d="M6 8h7M6 12h7M6 16h5M19 8h7M19 12h7M19 16h5" stroke-width="1.3"/>',
  footer: '<rect x="3" y="3" width="26" height="20" rx="2"/><rect x="3" y="15" width="26" height="8" rx="2" fill="currentColor" stroke="none" opacity=".25"/><path d="M7 7h18M7 11h12"/><path d="M11 19h10" stroke-width="1.3"/>',
  image: '<rect x="3" y="3" width="26" height="20" rx="2"/><circle cx="10" cy="10" r="2.5"/><path d="m3 20 8-7 6 5 4-3 8 6"/>',
  button: '<rect x="5" y="8" width="22" height="10" rx="5"/><path d="M11 13h10"/>',
  video: '<rect x="3" y="3" width="26" height="20" rx="2"/><path d="m13 8.5 7 4.5-7 4.5z" fill="currentColor"/>',
  divider: '<path d="M3 13h26"/><path d="M7 7h18M7 19h18" opacity=".35" stroke-width="1.3"/>',
  spacer: '<path d="M16 4v18"/><path d="m12 8 4-4 4 4M12 18l4 4 4-4"/><path d="M4 4h24M4 22h24" opacity=".4"/>',
  social: '<circle cx="8" cy="13" r="4"/><circle cx="16" cy="13" r="4"/><circle cx="24" cy="13" r="4"/>',
  gallery: '<rect x="2" y="6" width="8" height="12" rx="1"/><rect x="12" y="6" width="8" height="12" rx="1"/><rect x="22" y="6" width="8" height="12" rx="1"/><path d="m3 16 3-3 3 3M13 16l3-3 3 3M23 16l3-3 3 3" stroke-width="1.2"/>',
  card: '<rect x="7" y="2" width="18" height="22" rx="2"/><rect x="7" y="2" width="18" height="9" rx="2" fill="currentColor" stroke="none" opacity=".25"/><path d="M10 15h12M10 19h8" stroke-width="1.3"/>',
  imagetext: '<rect x="3" y="5" width="12" height="16" rx="1.5"/><path d="m4 18 4-4 3 3 3-2" stroke-width="1.2"/><path d="M18 8h11M18 12h11M18 16h8" stroke-width="1.3"/>',
  boxed: '<rect x="3" y="4" width="26" height="18" rx="3" fill="currentColor" opacity=".15" stroke="none"/><path d="M5 4v18" stroke-width="3"/><path d="M10 10h15M10 15h11" stroke-width="1.3"/>',
  table: '<rect x="3" y="3" width="26" height="20" rx="2"/><path d="M3 9.5h26M3 16h26M12 3v20M21 3v20" stroke-width="1.3"/>',
  code: '<path d="m11 7-6 6 6 6M21 7l6 6-6 6M18 5l-4 16"/>',
};
export function blockIcon(name) {
  return `<svg viewBox="0 0 32 26" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

export const ICONS = {
  grip: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

/**
 * Modal dialog. `body` is a Node; each action is { label, kind?: 'primary'|'danger', onClick?(close) }.
 * onClick may return false (or a promise of false) to keep the dialog open.
 * Returns a close() function.
 */
export function openDialog({ title, body, actions = [{ label: 'Close' }], wide = false, onClose }) {
  const previous = document.activeElement;
  const close = () => {
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
    previous?.focus?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const footer = h('footer', { class: 'app-modal-footer' });
  for (const a of actions) {
    const btn = h('button', { type: a.submit ? 'submit' : 'button', class: `app-btn${a.kind === 'primary' ? ' app-btn-primary' : a.kind === 'danger' ? ' app-btn-danger' : ''}` }, a.label);
    btn.addEventListener('click', async (e) => {
      if (a.submit) return; // handled by form submit
      e.preventDefault();
      if (!a.onClick) return close();
      btn.disabled = true;
      try {
        if ((await a.onClick(close)) !== false) close();
      } finally {
        btn.disabled = false;
      }
    });
    footer.append(btn);
  }
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  const card = h(
    'div',
    { class: `app-modal-card${wide ? ' app-modal-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('header', {}, h('h2', { id: titleId }, title), h('button', { type: 'button', class: 'app-icon-btn', 'aria-label': 'Close', html: ICONS.x, onclick: close })),
    h('div', { class: 'app-modal-body' }, body),
    actions.length ? footer : null,
  );
  const root = h('div', { class: 'app-modal' }, h('div', { class: 'app-modal-backdrop', onclick: close }), card);
  document.body.append(root);
  document.addEventListener('keydown', onKey, true);
  (card.querySelector('input, select, textarea') || card).focus();
  return close;
}

/** Small form dialog: resolves with the field values, or null if cancelled. */
export function promptDialog({ title, fields, submitLabel = 'Save', intro, validate }) {
  return new Promise((resolve) => {
    let done = false;
    const error = h('div', { class: 'app-login-error', role: 'alert', hidden: true });
    const inputs = {};
    const form = h('form', { class: 'app-form app-form-dialog', novalidate: true });
    if (intro) form.append(h('p', { class: 'app-dialog-intro' }, intro));
    form.append(error);
    for (const f of fields) {
      const id = `pd-${f.name}`;
      let input;
      if (f.type === 'select') {
        input = h('select', { id, name: f.name }, f.options.map(([v, l]) => h('option', { value: v }, l)));
      } else if (f.type === 'textarea') {
        input = h('textarea', { id, name: f.name, rows: 3 });
      } else {
        input = h('input', { id, name: f.name, class: 'app-input', type: f.type || 'text', autocomplete: f.autocomplete || 'off', spellcheck: 'false' });
      }
      if (f.value != null) input.value = f.value;
      inputs[f.name] = input;
      form.append(h('div', { class: 'app-field' }, h('label', { for: id }, f.label), input, f.help ? h('small', {}, f.help) : null));
    }
    const submit = async () => {
      const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
      const problem = validate ? await validate(values) : null;
      if (problem) {
        error.textContent = problem;
        error.hidden = false;
        return false;
      }
      done = true;
      resolve(values);
      return true;
    };
    let closeFn;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await submit()) closeFn();
    });
    form.append(h('button', { type: 'submit', hidden: true }));
    closeFn = openDialog({
      title,
      body: form,
      actions: [{ label: 'Cancel' }, { label: submitLabel, kind: 'primary', onClick: submit }],
      onClose: () => {
        if (!done) resolve(null);
      },
    });
  });
}

export function formatDate(ms) {
  if (!ms) return 'never';
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Dropdown menu attached to `button` (which must sit inside a `.app-menu` wrapper).
 * `render(list, close)` fills the list each time it opens, so contents can be live.
 */
export function dropdown(button, render, { wide = false } = {}) {
  const list = h('div', { class: `app-menu-list${wide ? ' app-menu-wide' : ''}`, role: 'menu', hidden: true });
  button.after(list);
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  const close = () => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const open = async () => {
    document.dispatchEvent(new CustomEvent('app-menu-open', { detail: list }));
    list.replaceChildren();
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    await render(list, close);
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (list.hidden) open();
    else close();
  });
  list.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
  document.addEventListener('app-menu-open', (e) => e.detail !== list && close());
  return { open, close };
}

export function menuItem(label, onClick, { sub, current = false, disabled = false } = {}) {
  return h('button', { type: 'button', role: 'menuitem', class: current ? 'is-current' : '', disabled, onclick: onClick }, label, sub ? h('small', {}, sub) : null);
}
