export const $ = (sel, root = document) => root.querySelector(sel);
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
  divider: '<path d="M3 13h26"/><path d="M7 7h18M7 19h18" opacity=".35" stroke-width="1.3"/>',
  spacer: '<path d="M16 4v18"/><path d="m12 8 4-4 4 4M12 18l4 4 4-4"/><path d="M4 4h24M4 22h24" opacity=".4"/>',
  social: '<circle cx="8" cy="13" r="4"/><circle cx="16" cy="13" r="4"/><circle cx="24" cy="13" r="4"/>',
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
