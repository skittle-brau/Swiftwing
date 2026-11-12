/**
 * Block catalogue shared by the browser editor and the Node export engine.
 *
 * Each block type declares:
 *  - label / group / icon        → sidebar palette
 *  - defaults()                  → initial props for a freshly dropped block
 *  - fields                      → inspector form schema (dot-paths into props)
 *
 * The data model is plain JSON so documents can be autosaved, versioned and
 * rendered identically on the client (canvas) and the server (export).
 */

export const SOCIAL_NETWORKS = {
  facebook: { label: 'Facebook', color: '#1877f2' },
  instagram: { label: 'Instagram', color: '#c13584' },
  x: { label: 'X', color: '#000000' },
  linkedin: { label: 'LinkedIn', color: '#0a66c2' },
  youtube: { label: 'YouTube', color: '#ff0000' },
  tiktok: { label: 'TikTok', color: '#010101' },
  website: { label: 'Website', color: '#4b5563' },
  email: { label: 'Email', color: '#4b5563' },
};

export const FONT_STACKS = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
  { value: "'Trebuchet MS', Helvetica, sans-serif", label: 'Trebuchet MS' },
  { value: 'Georgia, Times, serif', label: 'Georgia' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New' },
];

export const DEFAULT_SETTINGS = Object.freeze({
  projectName: 'Untitled Project',
  subject: 'School Newsletter',
  preheader: '',
  width: 600,
  fullWidth: false,
  bodyBg: '#f4f4f4',
  contentBg: '#ffffff',
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 16,
  lineHeight: 24,
  textColor: '#333333',
  headingColor: '#111111',
  linkColor: '#1a5fb4',
  assetBaseUrl: '',
  strictXhtml: true,
});

const align = { type: 'select', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] };
const pad = (key, label, max = 80) => ({ key, label, type: 'number', min: 0, max, suffix: 'px' });

export const BLOCK_TYPES = {
  header: {
    label: 'Header',
    group: 'layout',
    icon: 'header',
    defaults: () => ({
      logoSrc: '',
      logoAlt: 'Logo',
      logoWidth: 180,
      logoHref: '',
      html: '<h1>Newsletter Title</h1><p>Term 4 · Week 5</p>',
      align: 'center',
      bgColor: '#1a3a5c',
      textColor: '#ffffff',
      paddingX: 30,
      paddingY: 28,
    }),
    fields: [
      { key: 'logoSrc', label: 'Logo image', type: 'image' },
      { key: 'logoAlt', label: 'Logo alt text', type: 'text' },
      { key: 'logoWidth', label: 'Logo width', type: 'number', min: 20, max: 600, suffix: 'px' },
      { key: 'logoHref', label: 'Logo link', type: 'url' },
      { key: 'align', label: 'Alignment', ...align },
      { key: 'bgColor', label: 'Background', type: 'color' },
      { key: 'textColor', label: 'Text colour', type: 'color' },
      pad('paddingX', 'Horizontal padding'),
      pad('paddingY', 'Vertical padding'),
    ],
  },

  text: {
    label: '1 Column',
    group: 'layout',
    icon: 'col1',
    defaults: () => ({
      html: '<h2>Section heading</h2><p>Click here to start writing. Use the toolbar to add <strong>bold</strong> text, lists, tables and <a href="https://example.com">links</a>.</p>',
      bgColor: '',
      textColor: '',
      paddingX: 30,
      paddingY: 20,
    }),
    fields: [
      { key: 'bgColor', label: 'Background', type: 'color', allowEmpty: true },
      { key: 'textColor', label: 'Text colour', type: 'color', allowEmpty: true },
      pad('paddingX', 'Horizontal padding'),
      pad('paddingY', 'Vertical padding'),
    ],
  },

  columns2: {
    label: '2 Columns',
    group: 'layout',
    icon: 'col2',
    defaults: () => ({
      ratio: '50',
      gap: 20,
      valign: 'top',
      bgColor: '',
      paddingX: 30,
      paddingY: 20,
      columns: [
        { imageSrc: '', imageAlt: '', imageHref: '', html: '<h3>Left column</h3><p>Add text, lists or links here.</p>' },
        { imageSrc: '', imageAlt: '', imageHref: '', html: '<h3>Right column</h3><p>Columns stack on mobile devices.</p>' },
      ],
    }),
    fields: [
      { key: 'ratio', label: 'Column split', type: 'select', options: [['50', '50 / 50'], ['33', '33 / 67'], ['67', '67 / 33']] },
      { key: 'gap', label: 'Gutter', type: 'number', min: 0, max: 60, suffix: 'px' },
      { key: 'valign', label: 'Vertical align', type: 'select', options: [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']] },
      { key: 'columns.0.imageSrc', label: 'Left image', type: 'image' },
      { key: 'columns.0.imageAlt', label: 'Left image alt', type: 'text' },
      { key: 'columns.0.imageHref', label: 'Left image link', type: 'url' },
      { key: 'columns.1.imageSrc', label: 'Right image', type: 'image' },
      { key: 'columns.1.imageAlt', label: 'Right image alt', type: 'text' },
      { key: 'columns.1.imageHref', label: 'Right image link', type: 'url' },
      { key: 'bgColor', label: 'Background', type: 'color', allowEmpty: true },
      pad('paddingX', 'Horizontal padding'),
      pad('paddingY', 'Vertical padding'),
    ],
  },

  footer: {
    label: 'Footer',
    group: 'layout',
    icon: 'footer',
    defaults: () => ({
      html: '<p><strong>Your School Name</strong><br>123 Example Street, Suburb STATE 0000<br>Phone (00) 0000 0000</p><p><a href="https://example.com">Visit our website</a> · <a href="https://example.com/unsubscribe">Unsubscribe</a></p>',
      bgColor: '#eeeeee',
      textColor: '#666666',
      fontSize: 12,
      align: 'center',
      paddingX: 30,
      paddingY: 24,
    }),
    fields: [
      { key: 'align', label: 'Alignment', ...align },
      { key: 'fontSize', label: 'Font size', type: 'number', min: 9, max: 20, suffix: 'px' },
      { key: 'bgColor', label: 'Background', type: 'color' },
      { key: 'textColor', label: 'Text colour', type: 'color' },
      pad('paddingX', 'Horizontal padding'),
      pad('paddingY', 'Vertical padding'),
    ],
  },

  image: {
    label: 'Image',
    group: 'content',
    icon: 'image',
    defaults: () => ({
      src: '',
      alt: '',
      href: '',
      width: 0,
      align: 'center',
      bgColor: '',
      paddingX: 0,
      paddingY: 0,
    }),
    fields: [
      { key: 'src', label: 'Image', type: 'image' },
      { key: 'alt', label: 'Alt text', type: 'text', help: 'Describe the image — shown when images are blocked.' },
      { key: 'href', label: 'Link URL', type: 'url' },
      { key: 'width', label: 'Width (0 = full)', type: 'number', min: 0, max: 800, suffix: 'px' },
      { key: 'align', label: 'Alignment', ...align },
      { key: 'bgColor', label: 'Background', type: 'color', allowEmpty: true },
      pad('paddingX', 'Horizontal padding'),
      pad('paddingY', 'Vertical padding'),
    ],
  },

  video: {
    label: 'Video',
    group: 'content',
    icon: 'video',
    defaults: () => ({
      url: '',
      title: '',
      thumbnailSrc: '',
      playStyle: 'dark',
      width: 0,
      align: 'center',
      bgColor: '',
      paddingX: 30,
      paddingY: 16,
    }),
    fields: [
      { key: 'url', label: 'YouTube or Vimeo link', type: 'video' },
      { key: 'playStyle', label: 'Play button', type: 'select', options: [['dark', 'Dark'], ['light', 'Light']] },
      { key: 'title', label: 'Alt text', type: 'text', help: 'Filled in from the video title. Shown when images are blocked.' },
      { key: 'thumbnailSrc', label: 'Thumbnail', type: 'image', help: 'Created automatically with a play button. Choose another image to replace it.' },
      { key: 'width', label: 'Width (0 = full)', type: 'number', min: 0, max: 800, suffix: 'px' },
      { key: 'align', label: 'Alignment', ...align },
      { key: 'bgColor', label: 'Background', type: 'color', allowEmpty: true },
      pad('paddingX', 'Horizontal padding'),
      pad('paddingY', 'Vertical padding'),
    ],
  },

  button: {
    label: 'Button',
    group: 'content',
    icon: 'button',
    defaults: () => ({
      text: 'Read more',
      href: 'https://example.com',
      align: 'center',
      fullWidth: false,
      btnColor: '#1a5fb4',
      btnTextColor: '#ffffff',
      radius: 4,
      fontSize: 16,
      bgColor: '',
      paddingX: 30,
      paddingY: 16,
    }),
    fields: [
      { key: 'text', label: 'Label', type: 'text' },
      { key: 'href', label: 'Link URL', type: 'url' },
      { key: 'align', label: 'Alignment', ...align },
      { key: 'fullWidth', label: 'Full width', type: 'checkbox' },
      { key: 'btnColor', label: 'Button colour', type: 'color' },
      { key: 'btnTextColor', label: 'Label colour', type: 'color' },
      { key: 'radius', label: 'Corner radius', type: 'number', min: 0, max: 30, suffix: 'px' },
      { key: 'fontSize', label: 'Font size', type: 'number', min: 10, max: 28, suffix: 'px' },
      { key: 'bgColor', label: 'Row background', type: 'color', allowEmpty: true },
      pad('paddingX', 'Horizontal padding'),
      pad('paddingY', 'Vertical padding'),
    ],
  },

  divider: {
    label: 'Divider',
    group: 'content',
    icon: 'divider',
    defaults: () => ({ color: '#dddddd', thickness: 1, style: 'solid', bgColor: '', paddingX: 30, paddingY: 16 }),
    fields: [
      { key: 'color', label: 'Line colour', type: 'color' },
      { key: 'thickness', label: 'Thickness', type: 'number', min: 1, max: 10, suffix: 'px' },
      { key: 'style', label: 'Style', type: 'select', options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] },
      { key: 'bgColor', label: 'Background', type: 'color', allowEmpty: true },
      pad('paddingX', 'Horizontal padding'),
      pad('paddingY', 'Vertical padding'),
    ],
  },

  spacer: {
    label: 'Spacer',
    group: 'content',
    icon: 'spacer',
    defaults: () => ({ height: 24, bgColor: '' }),
    fields: [
      { key: 'height', label: 'Height', type: 'number', min: 4, max: 200, suffix: 'px' },
      { key: 'bgColor', label: 'Background', type: 'color', allowEmpty: true },
    ],
  },

  social: {
    label: 'Social Links',
    group: 'content',
    icon: 'social',
    defaults: () => ({
      items: [
        { network: 'facebook', url: 'https://facebook.com/', iconSrc: '' },
        { network: 'instagram', url: 'https://instagram.com/', iconSrc: '' },
        { network: 'linkedin', url: 'https://linkedin.com/', iconSrc: '' },
        { network: 'youtube', url: 'https://youtube.com/', iconSrc: '' },
      ],
      variant: 'brand',
      monoColor: '#1a3a5c',
      labelColor: '#ffffff',
      iconSize: 32,
      align: 'center',
      bgColor: '',
      paddingX: 30,
      paddingY: 16,
    }),
    fields: [
      { key: 'items', label: 'Links', type: 'social' },
      { key: 'variant', label: 'Style', type: 'select', options: [['brand', 'Brand colour pills'], ['mono', 'Single colour pills'], ['text', 'Text links']] },
      { key: 'monoColor', label: 'Pill colour (single)', type: 'color' },
      { key: 'labelColor', label: 'Label colour', type: 'color' },
      { key: 'iconSize', label: 'Icon size (custom icons)', type: 'number', min: 16, max: 64, suffix: 'px' },
      { key: 'align', label: 'Alignment', ...align },
      { key: 'bgColor', label: 'Background', type: 'color', allowEmpty: true },
      pad('paddingX', 'Horizontal padding'),
      pad('paddingY', 'Vertical padding'),
    ],
  },

  html: {
    label: 'Raw HTML',
    group: 'content',
    icon: 'code',
    defaults: () => ({
      html: '<p style="margin:0;padding:20px 30px;font-family:Arial, Helvetica, sans-serif;">Custom HTML goes here.</p>',
    }),
    fields: [{ key: 'html', label: 'HTML', type: 'code', help: 'Inserted as-is inside a full-width table cell. Use tables and inline styles.' }],
  },
};

let idCounter = 0;
export function newId() {
  idCounter = (idCounter + 1) % 1296;
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + idCounter.toString(36);
}

export function createBlock(type, overrides = {}) {
  const def = BLOCK_TYPES[type];
  if (!def) throw new Error(`Unknown block type: ${type}`);
  return { id: newId(), type, props: { ...def.defaults(), ...overrides } };
}

export function cloneBlock(block) {
  return { ...structuredClone(block), id: newId() };
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

export function createDocument(projectName = DEFAULT_SETTINGS.projectName) {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, projectName },
    blocks: [
      createBlock('header'),
      createBlock('text'),
      createBlock('button'),
      createBlock('divider'),
      createBlock('columns2'),
      createBlock('social'),
      createBlock('footer'),
    ],
  };
}

/** Fill in missing settings/props so older saved documents keep working. */
export function normalizeDocument(doc) {
  const out = {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(doc?.settings || {}) },
    blocks: [],
  };
  for (const b of Array.isArray(doc?.blocks) ? doc.blocks : []) {
    const def = BLOCK_TYPES[b?.type];
    if (!def) continue;
    out.blocks.push({ id: typeof b.id === 'string' && /^[a-z0-9]+$/i.test(b.id) ? b.id : newId(), type: b.type, props: { ...def.defaults(), ...(b.props || {}) } });
  }
  return out;
}
