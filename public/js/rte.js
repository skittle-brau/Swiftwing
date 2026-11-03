/**
 * TinyMCE inline rich-text editing for [data-ae-edit] regions in the canvas.
 *
 * Editors are created lazily on first click (keeps the canvas fast even with
 * many blocks) and torn down whenever their block is re-rendered.
 */
/* global tinymce */

const TOOLBAR =
  'undo redo | blocks fontsize | bold italic underline strikethrough | forecolor backcolor | ' +
  'alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link unlink | table | removeformat code';

let pendingPoint = null;
let seq = 0;

function caretFromPoint(x, y) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const r = document.createRange();
    r.setStart(pos.offsetNode, pos.offset);
    r.collapse(true);
    return r;
  }
  return null;
}

export function editorFor(el) {
  return el.id ? tinymce.get(el.id) : null;
}

/**
 * Turn `el` into an inline editor (or focus the existing one).
 * @param {HTMLElement} el
 * @param {{ onChange(html:string):void, onCommit():void, point?:{x:number,y:number}, linkColor?:string }} hooks
 */
export function activate(el, hooks) {
  const existing = editorFor(el);
  if (existing) {
    if (!existing.hasFocus()) existing.focus();
    return;
  }
  if (!el.id) el.id = `ae-rte-${++seq}`;
  pendingPoint = hooks.point || null;

  tinymce.init({
    target: el,
    inline: true,
    license_key: 'gpl',
    base_url: '/vendor/tinymce',
    suffix: '.min',
    menubar: false,
    branding: false,
    promotion: false,
    fixed_toolbar_container: '#rte-toolbar',
    toolbar_persist: false,
    toolbar_mode: 'wrap',
    plugins: 'lists advlist link autolink table code',
    toolbar: TOOLBAR,
    block_formats: 'Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3',
    font_size_formats: '10px 11px 12px 13px 14px 16px 18px 20px 22px 24px 28px 32px 36px 42px',
    forced_root_block: 'p',
    // Email-safe output: absolute URLs, no relative rewriting.
    convert_urls: false,
    relative_urls: false,
    remove_script_host: false,
    link_default_target: '_blank',
    link_assume_external_targets: 'https',
    link_target_list: false,
    // Tables: explicit attributes that email clients understand.
    table_default_attributes: { border: '0', cellpadding: '0', cellspacing: '0', width: '100%' },
    table_default_styles: { 'border-collapse': 'collapse', width: '100%' },
    table_sizing_mode: 'relative',
    table_style_by_css: true,
    table_header_type: 'cells',
    table_appearance_options: true,
    table_advtab: true,
    table_cell_advtab: true,
    // Strip anything an email client would choke on.
    invalid_elements: 'script,iframe,object,embed,form,input,button,select,textarea,video,audio,canvas,svg,style',
    extended_valid_elements: 'span[style|class],a[href|target|title|style|class|name]',
    paste_data_images: false,
    color_map: [
      '000000', 'Black', '333333', 'Charcoal', '666666', 'Grey', 'ffffff', 'White',
      '1a3a5c', 'Navy', '1a5fb4', 'Blue', '2e7d32', 'Green', 'c62828', 'Red',
      'ef6c00', 'Orange', 'f9a825', 'Gold', '6a1b9a', 'Purple', '00838f', 'Teal',
    ],
    setup(editor) {
      let lastHtml = null;
      const emit = () => {
        const html = editor.getContent();
        if (html === lastHtml) return;
        lastHtml = html;
        hooks.onChange(html);
      };
      editor.on('init', () => {
        lastHtml = editor.getContent();
        editor.focus();
        if (pendingPoint) {
          const rng = caretFromPoint(pendingPoint.x, pendingPoint.y);
          if (rng && el.contains(rng.startContainer)) editor.selection.setRng(rng);
          pendingPoint = null;
        }
      });
      editor.on('input change undo redo ExecCommand SetContent keyup', emit);
      editor.on('blur', () => {
        emit();
        hooks.onCommit?.();
      });
    },
  });
}

/** Remove every editor whose element sits inside `root` (or all editors). */
export function destroyWithin(root) {
  if (typeof tinymce === 'undefined') return;
  for (const ed of [...tinymce.get()]) {
    const el = ed.getElement();
    if (!root || !el || root.contains(el) || !el.isConnected) ed.remove();
  }
}

export function activeEditor() {
  return typeof tinymce !== 'undefined' ? tinymce.activeEditor : null;
}
