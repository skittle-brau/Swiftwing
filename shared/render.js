/**
 * Email renderer shared by the editor canvas and the export engine.
 *
 * Output rules (Outlook / Synergetic safe):
 *  - Every block is its own fixed-width <table> with explicit pixel widths.
 *  - No flexbox, grid, floats or positioned layout — only table/tr/td.
 *  - Global typography lives in a <style> block (buildCss) that the export
 *    pipeline inlines with `juice`; block-specific values are written inline.
 */
import { BLOCK_TYPES, DEFAULT_SETTINGS, SOCIAL_NETWORKS, FONT_STACKS } from './blocks.js';

export const XHTML_DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">';

/** Doctypes the export can target. `selfClose`: write void tags as <br /> (XHTML) or <br> (HTML). */
export const DOCTYPES = {
  html4: {
    label: 'HTML 4.01 Transitional',
    declaration: '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">',
    selfClose: false,
  },
  xhtml: { label: 'XHTML 1.0 Transitional', declaration: XHTML_DOCTYPE, selfClose: true },
  html5: { label: 'HTML5', declaration: '<!DOCTYPE html>', selfClose: false },
};

/* ---------------------------------------------------------------- helpers */

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Hex colours only — anything else falls back (prevents CSS injection). */
export function color(v, fallback = '') {
  const s = String(v ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return ('#' + s.slice(1).split('').map((c) => c + c).join('')).toLowerCase();
  }
  return fallback;
}

export function num(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pick(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

/** Reject script-capable URL schemes; everything else (incl. merge tags) is kept. */
export function safeUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\s*(javascript|vbscript|data):/i.test(s.replace(/[\u0000-\u001f\s]/g, ''))) return '';
  return s;
}

function fontStack(v) {
  const s = String(v ?? '');
  if (FONT_STACKS.some((f) => f.value === s)) return s;
  return /^[\w\s,'"-]+$/.test(s) ? s : DEFAULT_SETTINGS.fontFamily;
}

/** Make root-relative asset paths absolute so images resolve inside mail clients. */
export function resolveSrc(src, baseUrl) {
  const s = safeUrl(src);
  if (!s) return '';
  if (s.startsWith('/') && !s.startsWith('//') && baseUrl) return baseUrl.replace(/\/+$/, '') + s;
  return s;
}

export function normalizeSettings(raw = {}) {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  return {
    projectName: String(s.projectName || DEFAULT_SETTINGS.projectName),
    subject: String(s.subject ?? ''),
    preheader: String(s.preheader ?? ''),
    width: num(s.width, 320, 800, 600),
    fullWidth: s.fullWidth === true,
    bodyBg: color(s.bodyBg, DEFAULT_SETTINGS.bodyBg),
    contentBg: color(s.contentBg, DEFAULT_SETTINGS.contentBg),
    fontFamily: fontStack(s.fontFamily),
    fontSize: num(s.fontSize, 10, 24, 16),
    lineHeight: num(s.lineHeight, 12, 40, 24),
    textColor: color(s.textColor, DEFAULT_SETTINGS.textColor),
    headingColor: color(s.headingColor, DEFAULT_SETTINGS.headingColor),
    linkColor: color(s.linkColor, DEFAULT_SETTINGS.linkColor),
    assetBaseUrl: String(s.assetBaseUrl ?? '').trim(),
    doctype: Object.hasOwn(DOCTYPES, s.doctype) ? s.doctype : 'html4',
    synergetic: s.synergetic === true,
    strictXhtml: s.strictXhtml !== false,
  };
}

/* -------------------------------------------------------------- global CSS */

/**
 * Class-based stylesheet. During export juice converts every rule into inline
 * style="" attributes; only the @media block survives in <head> for clients
 * that support responsive email. The canvas injects the same CSS so the editor
 * is a faithful WYSIWYG.
 */
export function buildCss(doc, { includeResets = true } = {}) {
  const s = normalizeSettings(doc.settings);
  const F = s.fontFamily;
  const fs = s.fontSize;
  const lh = s.lineHeight;
  const rules = [];

  if (includeResets) {
    rules.push(
      `body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;background-color:${s.bodyBg};}`,
      `table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}`,
      `td{border-collapse:collapse;}`,
      `img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}`,
    );
  }

  rules.push(
    `.ae-wrapper{width:100%;background-color:${s.bodyBg};}`,
    `.ae-container{width:${s.fullWidth ? '100%' : `${s.width}px`};background-color:${s.contentBg};}`,
    `.ae-row{width:${s.fullWidth ? '100%' : `${s.width}px`};}`,
    `.ae-cell{font-family:${F};font-size:${fs}px;line-height:${lh}px;color:${s.textColor};}`,
    `.ae-rich{font-family:${F};font-size:${fs}px;line-height:${lh}px;}`,
    `.ae-rich p{margin:0 0 16px 0;font-family:${F};font-size:${fs}px;line-height:${lh}px;}`,
    `.ae-rich p:last-child{margin-bottom:0;}`,
    `.ae-rich h1{margin:0 0 12px 0;font-family:${F};font-size:${Math.round(fs * 1.9)}px;line-height:${Math.round(fs * 2.3)}px;font-weight:bold;color:${s.headingColor};}`,
    `.ae-rich h2{margin:0 0 12px 0;font-family:${F};font-size:${Math.round(fs * 1.5)}px;line-height:${Math.round(fs * 1.9)}px;font-weight:bold;color:${s.headingColor};}`,
    `.ae-rich h3{margin:0 0 10px 0;font-family:${F};font-size:${Math.round(fs * 1.2)}px;line-height:${Math.round(fs * 1.6)}px;font-weight:bold;color:${s.headingColor};}`,
    `.ae-rich h1:last-child,.ae-rich h2:last-child,.ae-rich h3:last-child{margin-bottom:0;}`,
    `.ae-rich a{color:${s.linkColor};text-decoration:underline;}`,
    `.ae-rich ul,.ae-rich ol{margin:0 0 16px 0;padding:0 0 0 24px;}`,
    `.ae-rich li{margin:0 0 6px 0;font-family:${F};font-size:${fs}px;line-height:${lh}px;}`,
    `.ae-rich table{border-collapse:collapse;}`,
    `.ae-rich td,.ae-rich th{padding:6px 8px;font-family:${F};font-size:${fs}px;line-height:${lh}px;vertical-align:top;}`,
    `.ae-rich th{font-weight:bold;text-align:left;}`,
    `.ae-rich img{max-width:100%;height:auto;}`,
    `.ae-img{display:block;border:0;outline:none;text-decoration:none;height:auto;}`,
    `.ae-preheader{display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${s.bodyBg};}`,
  );

  // Per-block typography overrides (heading/link colours, footer size).
  for (const b of doc.blocks || []) {
    const p = b.props || {};
    const sel = (t) => t.split(',').map((x) => `.ae-b-${b.id} ${x.trim()}`).join(',');
    const tc = color(p.textColor);
    if (tc && (b.type === 'header' || b.type === 'footer' || b.type === 'text')) {
      rules.push(`${sel('.ae-rich h1,.ae-rich h2,.ae-rich h3')}{color:${tc};}`);
      if (b.type !== 'text') rules.push(`${sel('.ae-rich a')}{color:${tc};}`);
    }
    if (b.type === 'table') {
      const f = num(p.fontSize, 9, 24, 14);
      const l = Math.round(f * 1.45);
      rules.push(`${sel('.ae-rich,.ae-rich p,.ae-rich li')}{font-size:${f}px;line-height:${l}px;}`);
      rules.push(`${sel('.ae-rich p,.ae-rich ul,.ae-rich ol')}{margin-bottom:${Math.round(f * 0.6)}px;}`);
      rules.push(`${sel('.ae-rich p:last-child')}{margin-bottom:0;}`);
      rules.push(`${sel('.ae-th .ae-rich,.ae-th .ae-rich p')}{font-weight:bold;}`);
    }
    if (b.type === 'boxedText' && p.variant === 'quote') {
      const f = s.fontSize + 2;
      rules.push(`${sel('.ae-rich p,.ae-rich li')}{font-style:italic;font-size:${f}px;line-height:${Math.round(f * 1.5)}px;}`);
    }
    if (b.type === 'footer') {
      const f = num(p.fontSize, 9, 20, 12);
      const l = Math.round(f * 1.5);
      rules.push(`${sel('.ae-rich,.ae-rich p,.ae-rich li,.ae-rich td')}{font-size:${f}px;line-height:${l}px;}`);
      rules.push(`${sel('.ae-rich p')}{margin-bottom:${Math.round(f * 0.8)}px;}`);
      rules.push(`${sel('.ae-rich p:last-child')}{margin-bottom:0;}`);
    }
  }

  // Responsive rules — preserved in <head> by juice (preserveMediaQueries).
  rules.push(
    `@media only screen and (max-width:${s.width + 20}px){` +
      `.ae-container,.ae-row{width:100% !important;}` +
      `.ae-col{display:block !important;width:100% !important;box-sizing:border-box;}` +
      `.ae-col-gap{display:block !important;width:100% !important;height:16px !important;}` +
      `.ae-fluid{width:100% !important;max-width:100% !important;height:auto !important;}` +
      `.ae-pad{padding-left:16px !important;padding-right:16px !important;}` +
      `.ae-btn-full{width:100% !important;}` +
      `.ae-social-item{display:inline-block !important;padding-bottom:8px !important;}` +
      `.ae-g2{width:50% !important;}.ae-g3{width:33% !important;}.ae-g4{width:25% !important;}` +
      `}`,
  );
  return rules.join('\n');
}

/* ------------------------------------------------------------ primitives */

function tableAttrs(ctx, extra = '') {
  // role="presentation" is valid in HTML5; HTML 4.01 and XHTML 1.0 don't define it.
  const role = ctx.settings.strictXhtml && ctx.settings.doctype !== 'html5' ? '' : ' role="presentation"';
  return `${role} cellpadding="0" cellspacing="0" border="0"${extra}`;
}

function rowTable(block, ctx, inner, { bg = '' } = {}) {
  const { width, fullWidth } = ctx.settings;
  const bgAttr = bg ? ` bgcolor="${bg}"` : '';
  const w = fullWidth ? '100%' : String(width);
  const cssW = fullWidth ? '100%' : `${width}px`;
  return (
    `<table class="ae-row ae-b-${block.id}" width="${w}"${tableAttrs(ctx)}${bgAttr} style="width:${cssW};${bg ? `background-color:${bg};` : ''}">` +
    `<tr>${inner}</tr></table>`
  );
}

function padStyle(px, py) {
  return `padding:${py}px ${px}px ${py}px ${px}px;`;
}

/** Rectangular cell grid: at least 1×1, every row padded to the widest row. */
export function normalizeCells(cells) {
  const rows = Array.isArray(cells) && cells.length ? cells.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])) : [['']];
  const width = Math.max(1, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
}

function rich(html, path, ctx, extraStyle = '') {
  const attr = ctx.editable ? ` data-ae-edit="${path}"` : '';
  const style = extraStyle ? ` style="${extraStyle}"` : '';
  return `<div class="ae-rich"${attr}${style}>${html || (ctx.editable ? '<p></p>' : '')}</div>`;
}

function imgTag({ src, alt, width, href, align = 'center', fluid = true }, ctx) {
  const url = resolveSrc(src, ctx.baseUrl);
  if (!url) return '';
  const margin = align === 'center' ? 'margin:0 auto;' : align === 'right' ? 'margin:0 0 0 auto;' : '';
  let tag =
    `<img src="${esc(url)}" alt="${esc(alt)}" width="${width}" class="ae-img${fluid ? ' ae-fluid' : ''}"` +
    ` style="display:block;width:${width}px;max-width:100%;height:auto;border:0;${margin}" />`;
  const link = safeUrl(href);
  if (link) tag = `<a href="${esc(link)}" target="_blank" style="text-decoration:none;">${tag}</a>`;
  return tag;
}

/**
 * Lay items out in rows of `n` equal columns inside `inner` px, `gap` px apart.
 * Full-width emails use percentage columns; images inside keep pixel sizes.
 * `cell(item, index, widthPx)` renders one item.
 */
function renderGrid(ctx, { items, n, gap, inner, stack, cell }) {
  const full = ctx.settings.fullWidth;
  const w = Math.floor((inner - gap * (n - 1)) / n);
  const pct = Math.floor(100 / n);
  const tdW = full ? `${pct}%` : String(w);
  const tdCss = full ? `${pct}%` : `${w}px`;
  // On phones: stacked items go full width; otherwise each keeps an equal share.
  const itemCls = stack ? 'ae-col' : `ae-gcell ae-g${n}`;
  const gapTd = gap
    ? `<td${stack ? ' class="ae-col-gap"' : ''} width="${gap}" style="width:${gap}px;font-size:0;line-height:0;">&nbsp;</td>`
    : '';
  const span = gap ? n * 2 - 1 : n;
  const rows = [];
  for (let start = 0; start < items.length; start += n) {
    if (start && gap) {
      rows.push(`<tr><td colspan="${span}" height="${gap}" style="height:${gap}px;font-size:0;line-height:0;">&nbsp;</td></tr>`);
    }
    const tds = [];
    for (let i = 0; i < n; i++) {
      const idx = start + i;
      if (i) tds.push(gapTd);
      const content = idx < items.length ? cell(items[idx], idx, w) : '&nbsp;';
      tds.push(`<td class="${itemCls}" width="${tdW}" valign="top" style="width:${tdCss};">${content}</td>`);
    }
    rows.push(`<tr>${tds.join('')}</tr>`);
  }
  const open = full
    ? `<table width="100%"${tableAttrs(ctx)} style="width:100%;">`
    : `<table width="${inner}"${tableAttrs(ctx)} style="width:100%;max-width:${inner}px;">`;
  return `${open}${rows.join('')}</table>`;
}

/** Small bulletproof button used inside cards. */
function smallButton(ctx, { text, href, bg, fg, align = 'left' }) {
  const s = ctx.settings;
  return (
    `<table${tableAttrs(ctx)} align="${align}" style="margin-top:14px;"><tr>` +
    `<td align="center" bgcolor="${bg}" style="background-color:${bg};border-radius:4px;padding:9px 18px;mso-padding-alt:9px 18px;">` +
    `<a href="${esc(safeUrl(href) || '#')}" target="_blank" style="color:${fg};text-decoration:none;font-family:${s.fontFamily};font-size:14px;line-height:18px;font-weight:bold;display:inline-block;">${esc(text)}</a>` +
    `</td></tr></table>`
  );
}

function placeholder(ctx, label, path, height = 160) {
  if (!ctx.editable) return '';
  return (
    `<div class="app-img-placeholder" data-ae-image="${path}" style="height:${height}px;">` +
    `<span>${esc(label)}</span><small>Drop an image here or click to choose</small></div>`
  );
}

/* ---------------------------------------------------------- block renderers */

const renderers = {
  header(b, ctx) {
    const p = b.props;
    const inner = ctx.settings.width;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 28);
    const a = pick(p.align, ['left', 'center', 'right'], 'center');
    const bg = color(p.bgColor);
    const tc = color(p.textColor, ctx.settings.textColor);
    const lw = Math.min(num(p.logoWidth, 20, 800, 180), inner - px * 2);
    const logo = p.logoSrc
      ? imgTag({ src: p.logoSrc, alt: p.logoAlt, width: lw, href: p.logoHref, align: a, fluid: false }, ctx)
      : '';
    const logoRow = logo || (ctx.editable ? placeholder(ctx, 'Logo (optional)', 'logoSrc', 60) : '');
    const html = p.html ? rich(p.html, 'html', ctx, `color:${tc};text-align:${a};`) : '';
    const spacer = logoRow && html ? `<div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>` : '';
    return rowTable(
      b,
      ctx,
      `<td class="ae-cell ae-pad" align="${a}" valign="top" style="${padStyle(px, py)}color:${tc};text-align:${a};">${logoRow}${spacer}${html}</td>`,
      { bg },
    );
  },

  text(b, ctx) {
    const p = b.props;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 20);
    const bg = color(p.bgColor);
    const tc = color(p.textColor, ctx.settings.textColor);
    return rowTable(
      b,
      ctx,
      `<td class="ae-cell ae-pad" align="left" valign="top" style="${padStyle(px, py)}color:${tc};">${rich(p.html, 'html', ctx, `color:${tc};`)}</td>`,
      { bg },
    );
  },

  columns2(b, ctx) {
    const p = b.props;
    const W = ctx.settings.width;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 20);
    const gap = num(p.gap, 0, 60, 20);
    const bg = color(p.bgColor);
    const valign = pick(p.valign, ['top', 'middle', 'bottom'], 'top');
    const inner = W - px * 2;
    const fixed = p.ratio === 'fixed';
    const r = { 50: 0.5, 33: 1 / 3, 67: 2 / 3 }[p.ratio] ?? 0.5;
    let widths;
    if (fixed) {
      // Exact pixel widths (e.g. a co-authored byline), scaled down only if they can't fit.
      widths = [num(p.leftWidth, 40, 800, 220), num(p.rightWidth, 40, 800, 220)];
      const room = inner - gap;
      const total = widths[0] + widths[1];
      if (total > room) widths = [Math.floor((widths[0] * room) / total), room - Math.floor((widths[0] * room) / total)];
    } else {
      const leftW = Math.round((inner - gap) * r);
      widths = [leftW, inner - gap - leftW];
    }
    const cols = (p.columns || []).slice(0, 2);
    while (cols.length < 2) cols.push({ html: '' });

    // Full-width emails split proportional columns by percentage; fixed columns stay in pixels.
    const full = ctx.settings.fullWidth && !fixed;
    const leftPct = Math.round(r * 100);
    const pcts = [leftPct, 100 - leftPct];
    const colTd = (c, i) => {
      const w = widths[i];
      const tdW = full ? `${pcts[i]}%` : String(w);
      const tdCss = full ? `${pcts[i]}%` : `${w}px`;
      const img = c.imageSrc
        ? imgTag({ src: c.imageSrc, alt: c.imageAlt, width: w, href: c.imageHref, align: 'left' }, ctx)
        : placeholder(ctx, 'Column image (optional)', `columns.${i}.imageSrc`, 90);
      const space = img && c.html ? `<div style="height:12px;line-height:12px;font-size:12px;">&nbsp;</div>` : '';
      return (
        `<td class="ae-col ae-cell" width="${tdW}" valign="${valign}" style="width:${tdCss};color:${ctx.settings.textColor};">` +
        `${img}${space}${rich(c.html, `columns.${i}.html`, ctx)}</td>`
      );
    };
    const gridW = widths[0] + widths[1] + gap;
    const gridAlign = pick(p.gridAlign, ['left', 'center', 'right'], 'left');
    const grid =
      (fixed
        ? `<table width="${gridW}"${tableAttrs(ctx)} align="${gridAlign}" style="width:${gridW}px;max-width:100%;"><tr>`
        : full
          ? `<table width="100%"${tableAttrs(ctx)} style="width:100%;"><tr>`
          : `<table width="${inner}"${tableAttrs(ctx)} style="width:100%;max-width:${inner}px;"><tr>`) +
      colTd(cols[0], 0) +
      (gap ? `<td class="ae-col-gap" width="${gap}" style="width:${gap}px;font-size:0;line-height:0;">&nbsp;</td>` : '') +
      colTd(cols[1], 1) +
      `</tr></table>`;
    return rowTable(b, ctx, `<td class="ae-pad" valign="top" style="${padStyle(px, py)}">${grid}</td>`, { bg });
  },

  footer(b, ctx) {
    const p = b.props;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 24);
    const a = pick(p.align, ['left', 'center', 'right'], 'center');
    const bg = color(p.bgColor);
    const tc = color(p.textColor, '#666666');
    const f = num(p.fontSize, 9, 20, 12);
    return rowTable(
      b,
      ctx,
      `<td class="ae-cell ae-pad" align="${a}" valign="top" style="${padStyle(px, py)}color:${tc};text-align:${a};font-size:${f}px;line-height:${Math.round(f * 1.5)}px;">` +
        `${rich(p.html, 'html', ctx, `color:${tc};text-align:${a};`)}</td>`,
      { bg },
    );
  },

  image(b, ctx) {
    const p = b.props;
    const px = num(p.paddingX, 0, 80, 0);
    const py = num(p.paddingY, 0, 80, 0);
    const a = pick(p.align, ['left', 'center', 'right'], 'center');
    const bg = color(p.bgColor);
    const inner = ctx.settings.width - px * 2;
    const w = p.width ? Math.min(num(p.width, 1, 800, inner), inner) : inner;
    const content = p.src
      ? imgTag({ src: p.src, alt: p.alt, width: w, href: p.href, align: a }, ctx)
      : placeholder(ctx, 'Image', 'src', 200);
    if (!content) return '';
    return rowTable(
      b,
      ctx,
      `<td${px ? ' class="ae-pad"' : ''} align="${a}" valign="top" style="${padStyle(px, py)}font-size:0;line-height:0;">${content}</td>`,
      { bg },
    );
  },

  video(b, ctx) {
    const p = b.props;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 16);
    const a = pick(p.align, ['left', 'center', 'right'], 'center');
    const bg = color(p.bgColor);
    const inner = ctx.settings.width - px * 2;
    const w = p.width ? Math.min(num(p.width, 1, 800, inner), inner) : inner;
    const title = String(p.title || '').trim();
    let content = '';
    if (p.thumbnailSrc) {
      content = imgTag({ src: p.thumbnailSrc, alt: title ? `Play video: ${title}` : 'Play video', width: w, href: p.url, align: a }, ctx);
    } else if (ctx.editable) {
      content =
        `<div class="app-img-placeholder app-video-placeholder" style="height:${Math.round((w * 9) / 16)}px;">` +
        `<span>Video</span><small>Paste a YouTube or Vimeo link in the panel on the right</small></div>`;
    }
    if (!content) return '';
    return rowTable(
      b,
      ctx,
      `<td${px ? ' class="ae-pad"' : ''} align="${a}" valign="top" style="${padStyle(px, py)}font-size:0;line-height:0;">${content}</td>`,
      { bg },
    );
  },

  button(b, ctx) {
    const p = b.props;
    const s = ctx.settings;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 16);
    const a = pick(p.align, ['left', 'center', 'right'], 'center');
    const bg = color(p.bgColor);
    const btn = color(p.btnColor, '#1a5fb4');
    const fg = color(p.btnTextColor, '#ffffff');
    const radius = num(p.radius, 0, 30, 4);
    const fs = num(p.fontSize, 10, 28, 16);
    const href = safeUrl(p.href) || '#';
    const full = !!p.fullWidth;
    const editAttr = ctx.editable ? ' data-ae-text="text"' : '';
    const label = `<span${editAttr}>${esc(p.text || 'Button')}</span>`;
    const widthAttr = full ? ` width="100%"` : '';
    const btnTable =
      `<table class="ae-button${full ? ' ae-btn-full' : ''}"${tableAttrs(ctx)}${widthAttr} align="${a}" style="${full ? 'width:100%;' : ''}">` +
      `<tr><td align="center" valign="middle" bgcolor="${btn}" style="background-color:${btn};border-radius:${radius}px;padding:12px 28px;mso-padding-alt:12px 28px;">` +
      `<a href="${esc(href)}" target="_blank" style="color:${fg};text-decoration:none;font-family:${s.fontFamily};font-size:${fs}px;line-height:${Math.round(fs * 1.25)}px;font-weight:bold;display:inline-block;">${label}</a>` +
      `</td></tr></table>`;
    return rowTable(
      b,
      ctx,
      `<td class="ae-pad" align="${a}" valign="top" style="${padStyle(px, py)}">${btnTable}</td>`,
      { bg },
    );
  },

  divider(b, ctx) {
    const p = b.props;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 16);
    const bg = color(p.bgColor);
    const c = color(p.color, '#dddddd');
    const t = num(p.thickness, 1, 10, 1);
    const st = pick(p.style, ['solid', 'dashed', 'dotted'], 'solid');
    const line =
      `<table width="100%"${tableAttrs(ctx)} style="width:100%;"><tr>` +
      `<td height="${t}" style="border-top:${t}px ${st} ${c};font-size:1px;line-height:1px;height:1px;">&nbsp;</td>` +
      `</tr></table>`;
    return rowTable(b, ctx, `<td class="ae-pad" valign="top" style="${padStyle(px, py)}">${line}</td>`, { bg });
  },

  spacer(b, ctx) {
    const p = b.props;
    const h = num(p.height, 4, 200, 24);
    const bg = color(p.bgColor);
    return rowTable(
      b,
      ctx,
      `<td height="${h}" style="height:${h}px;font-size:${h}px;line-height:${h}px;">&nbsp;</td>`,
      { bg },
    );
  },

  social(b, ctx) {
    const p = b.props;
    const s = ctx.settings;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 16);
    const a = pick(p.align, ['left', 'center', 'right'], 'center');
    const bg = color(p.bgColor);
    const variant = pick(p.variant, ['brand', 'mono', 'text'], 'brand');
    const labelColor = color(p.labelColor, '#ffffff');
    const mono = color(p.monoColor, '#1a3a5c');
    const size = num(p.iconSize, 16, 64, 32);
    const items = (p.items || []).filter((i) => i && SOCIAL_NETWORKS[i.network]);

    const cells = items.map((item, idx) => {
      const net = SOCIAL_NETWORKS[item.network];
      const href = esc(safeUrl(item.url) || '#');
      const icon = resolveSrc(item.iconSrc, ctx.baseUrl);
      const sidePad = idx === items.length - 1 ? 0 : 8;
      if (icon) {
        return (
          `<td class="ae-social-item" valign="middle" style="padding:0 ${sidePad}px 0 0;">` +
          `<a href="${href}" target="_blank" style="text-decoration:none;"><img src="${esc(icon)}" alt="${esc(net.label)}" width="${size}" height="${size}" style="display:block;width:${size}px;height:${size}px;border:0;" /></a></td>`
        );
      }
      if (variant === 'text') {
        const sep = idx === items.length - 1 ? '' : `<span style="color:${s.textColor};">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`;
        return (
          `<td class="ae-cell ae-social-item" valign="middle" style="font-size:14px;line-height:20px;">` +
          `<a href="${href}" target="_blank" style="color:${s.linkColor};text-decoration:underline;font-family:${s.fontFamily};font-size:14px;">${esc(net.label)}</a>${sep}</td>`
        );
      }
      const pill = variant === 'brand' ? net.color : mono;
      return (
        `<td class="ae-social-item" valign="middle" style="padding:0 ${sidePad}px 0 0;">` +
        `<table${tableAttrs(ctx)}><tr><td bgcolor="${pill}" style="background-color:${pill};border-radius:16px;padding:6px 14px;">` +
        `<a href="${href}" target="_blank" style="color:${labelColor};text-decoration:none;font-family:${s.fontFamily};font-size:13px;line-height:18px;font-weight:bold;">${esc(net.label)}</a>` +
        `</td></tr></table></td>`
      );
    });

    const inner = cells.length
      ? `<table${tableAttrs(ctx)} align="${a}" style="text-align:${a};"><tr>${cells.join('')}</tr></table>`
      : ctx.editable
        ? `<div class="app-empty-inline">Add social links in the inspector →</div>`
        : '';
    return rowTable(b, ctx, `<td class="ae-pad" align="${a}" valign="top" style="${padStyle(px, py)}">${inner}</td>`, { bg });
  },

  imageGroup(b, ctx) {
    const p = b.props;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 16);
    const gap = num(p.gap, 0, 40, 10);
    const n = num(p.perRow, 2, 4, 3);
    const bg = color(p.bgColor);
    const inner = ctx.settings.width - px * 2;
    const items = (Array.isArray(p.images) ? p.images : []).filter(Boolean);
    if (!items.length) return '';
    const grid = renderGrid(ctx, {
      items,
      n,
      gap,
      inner,
      stack: !!p.stackOnMobile,
      cell: (it, i, w) => {
        const img = it.src
          ? imgTag({ src: it.src, alt: it.alt, width: w, href: it.href, align: 'center' }, ctx)
          : placeholder(ctx, 'Image', `images.${i}.src`, Math.round(w * 0.66));
        const cap = String(it.caption || '').trim()
          ? `<div class="ae-cell" style="padding-top:6px;font-size:13px;line-height:18px;text-align:center;color:${ctx.settings.textColor};">${esc(it.caption)}</div>`
          : '';
        return img + cap || '&nbsp;';
      },
    });
    return rowTable(b, ctx, `<td class="ae-pad" valign="top" style="${padStyle(px, py)}">${grid}</td>`, { bg });
  },

  imageCard(b, ctx) {
    const p = b.props;
    const s = ctx.settings;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 16);
    const gap = num(p.gap, 0, 40, 20);
    const n = num(p.perRow, 1, 3, 2);
    const bg = color(p.bgColor);
    const cardBg = color(p.cardBg, '#ffffff');
    const bw = num(p.borderWidth, 0, 6, 1);
    const border = bw ? `border:${bw}px solid ${color(p.borderColor, '#dfe3e8')};` : '';
    const radius = num(p.radius, 0, 24, 6);
    const cp = num(p.cardPadding, 0, 40, 16);
    const ts = num(p.titleSize, 12, 32, 18);
    const titleColor = color(p.titleColor, s.headingColor);
    const btnBg = color(p.btnColor, '#1a5fb4');
    const btnFg = color(p.btnTextColor, '#ffffff');
    const inner = s.width - px * 2;
    const cards = (Array.isArray(p.cards) ? p.cards : []).filter(Boolean);
    if (!cards.length) return '';
    const grid = renderGrid(ctx, {
      items: cards,
      n,
      gap,
      inner,
      stack: true,
      cell: (c, i, w) => {
        const imgW = w - bw * 2;
        const img = c.imageSrc
          ? imgTag({ src: c.imageSrc, alt: c.imageAlt, width: imgW, href: c.imageHref, align: 'left' }, ctx)
          : placeholder(ctx, 'Card image', `cards.${i}.imageSrc`, Math.round(imgW * 0.56));
        const titleText = String(c.title || '');
        const editAttr = ctx.editable ? ` data-ae-text="cards.${i}.title"` : '';
        const title =
          titleText || ctx.editable
            ? `<h3 style="margin:0 0 8px 0;font-family:${s.fontFamily};font-size:${ts}px;line-height:${Math.round(ts * 1.3)}px;font-weight:bold;color:${titleColor};"><span${editAttr}>${esc(titleText)}</span></h3>`
            : '';
        const button = String(c.buttonText || '').trim() ? smallButton(ctx, { text: c.buttonText, href: c.buttonHref, bg: btnBg, fg: btnFg }) : '';
        return (
          `<table width="100%"${tableAttrs(ctx)} bgcolor="${cardBg}" style="width:100%;border-collapse:separate;background-color:${cardBg};${border}border-radius:${radius}px;">` +
          (img ? `<tr><td style="padding:0;font-size:0;line-height:0;">${img}</td></tr>` : '') +
          `<tr><td class="ae-cell" valign="top" style="padding:${cp}px;color:${s.textColor};">${title}${rich(c.html, `cards.${i}.html`, ctx)}${button}</td></tr>` +
          `</table>`
        );
      },
    });
    return rowTable(b, ctx, `<td class="ae-pad" valign="top" style="${padStyle(px, py)}">${grid}</td>`, { bg });
  },

  imageText(b, ctx) {
    const p = b.props;
    const s = ctx.settings;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 20);
    const bg = color(p.bgColor);
    const inner = s.width - px * 2;
    const pos = pick(p.imagePosition, ['left', 'right', 'top'], 'left');
    const text = rich(p.html, 'html', ctx, `color:${s.textColor};`);

    if (pos === 'top') {
      const w = p.topImageWidth ? Math.min(num(p.topImageWidth, 1, 800, inner), inner) : inner;
      const img = p.imageSrc
        ? imgTag({ src: p.imageSrc, alt: p.imageAlt, width: w, href: p.imageHref, align: 'left' }, ctx)
        : placeholder(ctx, 'Image', 'imageSrc', 180);
      const space = img ? `<div style="height:14px;line-height:14px;font-size:14px;">&nbsp;</div>` : '';
      return rowTable(b, ctx, `<td class="ae-cell ae-pad" valign="top" style="${padStyle(px, py)}color:${s.textColor};">${img}${space}${text}</td>`, { bg });
    }

    const gap = num(p.gap, 0, 60, 20);
    const valign = pick(p.valign, ['top', 'middle', 'bottom'], 'top');
    const imgW = Math.max(40, Math.min(num(p.imageWidth, 60, 500, 200), inner - gap - 100));
    const textW = inner - gap - imgW;
    const full = s.fullWidth;
    const img = p.imageSrc
      ? imgTag({ src: p.imageSrc, alt: p.imageAlt, width: imgW, href: p.imageHref, align: 'left' }, ctx)
      : placeholder(ctx, 'Image', 'imageSrc', Math.round(imgW * 0.75));
    // dir="rtl" puts the image on the right on desktop while keeping it first in
    // the markup, so on phones it still stacks above the text.
    const dir = pos === 'right' ? 'rtl' : 'ltr';
    const open = full
      ? `<table width="100%"${tableAttrs(ctx)} dir="${dir}" style="width:100%;">`
      : `<table width="${inner}"${tableAttrs(ctx)} dir="${dir}" style="width:100%;max-width:${inner}px;">`;
    const grid =
      `${open}<tr>` +
      `<td class="ae-col" width="${imgW}" valign="${valign}" dir="ltr" style="width:${imgW}px;">${img || '&nbsp;'}</td>` +
      (gap ? `<td class="ae-col-gap" width="${gap}" style="width:${gap}px;font-size:0;line-height:0;">&nbsp;</td>` : '') +
      `<td class="ae-col ae-cell"${full ? '' : ` width="${textW}"`} valign="${valign}" dir="ltr" style="${full ? '' : `width:${textW}px;`}text-align:left;color:${s.textColor};">${text}</td>` +
      `</tr></table>`;
    return rowTable(b, ctx, `<td class="ae-pad" valign="top" style="${padStyle(px, py)}">${grid}</td>`, { bg });
  },

  boxedText(b, ctx) {
    const p = b.props;
    const s = ctx.settings;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 16);
    const bg = color(p.bgColor);
    const variant = pick(p.variant, ['box', 'accent', 'quote', 'plain'], 'box');
    const boxBg = color(p.boxBg);
    const accent = color(p.accentColor, '#1a5fb4');
    const bw = num(p.borderWidth, 1, 10, 1);
    const radius = num(p.radius, 0, 24, 6);
    const pad = num(p.boxPadding, 0, 50, 20);
    const fg = color(p.textColor, s.textColor);
    let border = '';
    let corners = `border-radius:${radius}px;`;
    if (variant === 'box') border = `border:${bw}px solid ${accent};`;
    if (variant === 'accent' || variant === 'quote') {
      // A 1px bar is hard to see; accent bars are at least 3px.
      border = `border-left:${Math.max(3, bw)}px solid ${accent};`;
      corners = radius ? `border-radius:0 ${radius}px ${radius}px 0;` : '';
    }
    const box =
      `<table width="100%"${tableAttrs(ctx)} style="width:100%;border-collapse:separate;"><tr>` +
      `<td class="ae-cell"${boxBg ? ` bgcolor="${boxBg}"` : ''} valign="top" style="${boxBg ? `background-color:${boxBg};` : ''}${border}${corners}padding:${pad}px;color:${fg};">` +
      `${rich(p.html, 'html', ctx, `color:${fg};`)}</td></tr></table>`;
    return rowTable(b, ctx, `<td class="ae-pad" valign="top" style="${padStyle(px, py)}">${box}</td>`, { bg });
  },

  table(b, ctx) {
    const p = b.props;
    const s = ctx.settings;
    const px = num(p.paddingX, 0, 80, 30);
    const py = num(p.paddingY, 0, 80, 16);
    const bg = color(p.bgColor);
    const rows = normalizeCells(p.cells);
    const nCols = rows[0].length;
    const style = pick(p.borderStyle, ['all', 'rows', 'outer', 'none'], 'all');
    const bw = num(p.borderWidth, 1, 6, 1);
    const line = `${bw}px solid ${color(p.borderColor, '#d0d5dd')}`;
    const pad = num(p.cellPadding, 0, 30, 8);
    const fs = num(p.fontSize, 9, 24, 14);
    const align = pick(p.textAlign, ['left', 'center', 'right'], 'left');
    const valign = pick(p.valign, ['top', 'middle', 'bottom'], 'top');
    const header = !!p.headerRow;
    const headerBg = color(p.headerBg);
    const headerColor = color(p.headerColor);
    const stripe = color(p.stripeBg);
    const equal = p.colWidths !== 'auto';
    const pct = Math.floor(100 / nCols);

    const borders = (r, c) => {
      if (style === 'none') return '';
      if (style === 'all') return `border:${line};`;
      const last = r === rows.length - 1;
      if (style === 'rows') return `border-top:${line};${last ? `border-bottom:${line};` : ''}`;
      // outer
      return (
        (r === 0 ? `border-top:${line};` : '') +
        (last ? `border-bottom:${line};` : '') +
        (c === 0 ? `border-left:${line};` : '') +
        (c === nCols - 1 ? `border-right:${line};` : '')
      );
    };

    const body = rows
      .map((cells, r) => {
        const isHead = header && r === 0;
        const dataIndex = header ? r - 1 : r;
        const rowBg = isHead ? headerBg : stripe && dataIndex % 2 === 1 ? stripe : '';
        const tag = isHead ? 'th' : 'td';
        const tds = cells
          .map((html, c) => {
            const fg = isHead && headerColor ? headerColor : s.textColor;
            const width = equal ? ` width="${c === nCols - 1 ? 100 - pct * (nCols - 1) : pct}%"` : '';
            const content = html || (ctx.editable ? '' : '&nbsp;');
            return (
              `<${tag} class="ae-cell${isHead ? ' ae-th' : ''}" align="${align}" valign="${valign}"${width}${rowBg ? ` bgcolor="${rowBg}"` : ''}` +
              ` style="${borders(r, c)}padding:${pad}px;text-align:${align};vertical-align:${valign};font-size:${fs}px;line-height:${Math.round(fs * 1.45)}px;color:${fg};${isHead ? 'font-weight:bold;' : ''}${rowBg ? `background-color:${rowBg};` : ''}">` +
              `${rich(content, `cells.${r}.${c}`, ctx, `color:${fg};`)}</${tag}>`
            );
          })
          .join('');
        return `<tr>${tds}</tr>`;
      })
      .join('');

    const table = `<table class="ae-table" width="100%"${tableAttrs(ctx)} style="width:100%;border-collapse:collapse;">${body}</table>`;
    return rowTable(b, ctx, `<td class="ae-pad" valign="top" style="${padStyle(px, py)}">${table}</td>`, { bg });
  },

  html(b, ctx) {
    const raw = String(b.props.html ?? '');
    const content = ctx.editable && ctx.sanitizeRaw ? ctx.sanitizeRaw(raw) : raw;
    return rowTable(b, ctx, `<td valign="top">${content}</td>`);
  },
};

export function renderBlock(block, ctx) {
  const fn = renderers[block.type];
  if (!fn || !BLOCK_TYPES[block.type]) return '';
  return fn(block, ctx);
}

export function makeContext(doc, opts = {}) {
  return {
    settings: normalizeSettings(doc.settings),
    editable: !!opts.editable,
    baseUrl: opts.baseUrl ?? normalizeSettings(doc.settings).assetBaseUrl,
    sanitizeRaw: opts.sanitizeRaw,
  };
}

/**
 * Full email document *before* CSS inlining. The export engine pipes this
 * through juice + XHTML normalisation (server/lib/exporter.js).
 */
export function renderEmailDocument(doc, opts = {}) {
  const ctx = makeContext(doc, { ...opts, editable: false });
  const s = ctx.settings;
  const W = s.width;
  const body = (doc.blocks || []).map((b) => renderBlock(b, ctx)).join('\n');
  const ns = s.strictXhtml ? '' : ' xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"';
  const pre = s.preheader
    ? `<div class="ae-preheader">${esc(s.preheader)}${'&#847;&#160;'.repeat(40)}</div>\n`
    : '';

  const dt = DOCTYPES[s.doctype];
  const htmlTag =
    s.doctype === 'xhtml'
      ? `<html xmlns="http://www.w3.org/1999/xhtml"${ns} xml:lang="en" lang="en">`
      : `<html lang="en"${ns}>`;
  const charset =
    s.doctype === 'html5'
      ? '<meta charset="UTF-8" />'
      : '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />';
  // HTML 4.01 and XHTML 1.0 require type="text/css"; HTML5 doesn't need it.
  const styleOpen = s.doctype === 'html5' ? '<style>' : '<style type="text/css">';

  return `${dt.declaration}
${htmlTag}
<head>
${charset}
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="format-detection" content="telephone=no" />
<title>${esc(s.subject || s.projectName)}</title>
${styleOpen}
${buildCss(doc)}
</style>
<!--[if mso]>
<style type="text/css">
table, td, div, p, a, span, li, h1, h2, h3 { font-family: ${s.fontFamily.replace(/'/g, '')} !important; }
</style>
<xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
</head>
<body class="ae-body" bgcolor="${s.bodyBg}" style="margin:0;padding:0;background-color:${s.bodyBg};">
${pre}<table class="ae-wrapper" width="100%"${tableAttrs(ctx)} bgcolor="${s.bodyBg}">
<tr>
<td align="center" valign="top" style="padding:${s.fullWidth ? '0' : '20px 0 20px 0'};">
${s.fullWidth ? '' : `<!--[if mso]><table align="center" width="${W}" cellpadding="0" cellspacing="0" border="0"><tr><td width="${W}"><![endif]-->\n`}<table class="ae-container" width="${s.fullWidth ? '100%' : W}"${tableAttrs(ctx)} align="center" bgcolor="${s.contentBg}">
<tr>
<td align="left" valign="top">
${body}
</td>
</tr>
</table>
${s.fullWidth ? '' : '<!--[if mso]></td></tr></table><![endif]-->\n'}</td>
</tr>
</table>
</body>
</html>`;
}
