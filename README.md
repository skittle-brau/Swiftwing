# Atelier Email Builder

A WYSIWYG, drag-and-drop HTML email editor. It exports **XHTML 1.0 Transitional**, **table-based** HTML with **all CSS inlined**, so the output can be pasted into Synergetic and other school or enterprise mailers and still render in Outlook desktop, Gmail and Apple Mail.

![Layout: block palette · canvas · inspector](https://img.shields.io/badge/stack-Node%2022%20·%20Express%205%20·%20TinyMCE%208%20·%20SortableJS%20·%20juice-1a3a5c)

## Quick start

```bash
npm install
npm start            # http://localhost:3000
```

`npm run dev` restarts on file changes, and `npm test` runs the test suite.

To configure the server, copy `.env.example` to `.env`:

| Variable          | Default      | Purpose |
|-------------------|--------------|---------|
| `PORT`            | `3000`       | HTTP port |
| `UPLOAD_DIR`      | `./uploads`  | Root folder for uploaded images |
| `PUBLIC_BASE_URL` | request origin | Public origin used to make `/uploads/...` image URLs absolute in exported HTML. **Set this in production** so that recipients can load images. |
| `MAX_IMAGE_WIDTH` | `1200`       | Uploaded images wider than this are downscaled |
| `JPEG_QUALITY`    | `82`         | JPEG compression quality (1–100) |

### Docker

```bash
docker build -t atelier-email-builder .
docker run -p 3000:3000 -v atelier-uploads:/data/uploads \
  -e PUBLIC_BASE_URL=https://email-assets.example.org atelier-email-builder
```

## Features

### Drag-and-drop canvas
- **Layouts:** Header, 1 Column, 2 Columns (50/50, 33/67, 67/33, stacking on mobile), Footer.
- **Content:** Image, Button (bulletproof table button), Divider, Spacer, Social Links, Raw HTML.
- Drag blocks from the left sidebar onto the canvas, or click one to insert it after the current selection.
- Reorder blocks with the ⠿ handle. Each block's toolbar can also move it up or down, duplicate it and delete it.
- Keyboard shortcuts: <kbd>Ctrl/⌘ Z</kbd> undo, <kbd>Ctrl/⌘ Shift Z</kbd> or <kbd>Ctrl Y</kbd> redo, <kbd>Ctrl/⌘ D</kbd> duplicate, <kbd>Del</kbd> delete, <kbd>Esc</kbd> deselect.
- Edit block settings (colours, padding, alignment, links, widths) in the inspector on the right. Document-wide settings (width, fonts, colours, preheader, asset base URL) appear there when no block is selected.
- The design autosaves to `localStorage`. **File → Save/Open design** round-trips it as a `.json` file.

### Rich text (TinyMCE 8, inline mode)
Click any text in the canvas to edit it in place. The toolbar is pinned above the canvas and has:
- block formats (P/H1–H3) and pixel font sizes
- bold, italic, underline and strikethrough, plus text and highlight colours
- alignment, bulleted and numbered lists, and indent
- links (default `target="_blank"`, absolute URLs preserved)
- tables, created with `border/cellpadding/cellspacing` attributes
- remove formatting and a source-code view

Button labels can also be edited directly on the canvas.

TinyMCE is self-hosted from `node_modules`, so it needs no API key or CDN. It runs under its GPL licence (`license_key: 'gpl'`), which is compatible with this project's GPL-3.0 licence.

### Image uploads → `YYYY/MM/ProjectName/`
- Add images in any of these ways:
  - drop them in the **Media** tab
  - drop a file from your desktop onto the canvas, which creates an Image block
  - drop a file onto any image placeholder
  - use **Choose / upload…** in the inspector
- Files are stored as `uploads/<year>/<month>/<ProjectName>/<file>`, for example `uploads/2026/11/Spring-Newsletter/hero-banner.png`. The folder comes from the project name in the top bar and the upload date.
- Project names and file names are sanitised. Path traversal is blocked, duplicate names are suffixed (`-1`, `-2`…), and uploads are limited to 25 MB each, 10 at a time.
- **Every upload is optimised before it is stored** ([sharp](https://sharp.pixelplumbing.com/)):
  - Images wider than **1200 px** are downscaled (never upscaled). That's twice the 600 px email width, so images stay sharp on hi-DPI screens.
  - JPEGs are re-compressed with mozjpeg, and PNGs are compressed losslessly.
  - Phone photos are rotated upright from their EXIF orientation, which Outlook ignores. Metadata such as camera details and GPS location is removed.
  - Colours are converted to sRGB.
  - WebP is converted to JPEG, or to PNG if it has transparency, because Outlook desktop can't display WebP.
  - Animated GIFs keep their animation.
  - Files are checked by their actual content, not the type the browser claims. Only PNG, JPEG, GIF and WebP are accepted.
- Drag a library image onto the canvas to insert it. Each library image also has buttons to insert it, copy its absolute URL, or delete it.

### Export engine (Synergetic / Outlook safe)
`server/lib/exporter.js` runs every export through this pipeline:

1. **Render.** The shared renderer (`shared/render.js`) outputs one fixed-width `<table>` per block. Every layout uses `table`/`tr`/`td` with `width=""` attributes and explicit pixel widths. It never uses flexbox, grid, floats or positioning. An Outlook "ghost table" in `<!--[if mso]>` comments locks the container width.
2. **Inline CSS with [`juice`](https://github.com/Automattic/juice).** Class-based typography rules (`.ae-rich p`, `.ae-rich h2`, `.ae-rich a`, …) are written into `style="..."` attributes on each `td`, `p`, `li`, `a` and `span`. Only the `@media` block stays in `<head>`, so clients that support it can stack columns on mobile.
3. **XHTML normalisation.** The exact `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ...>` and `xmlns` are added. In the output:
   - void tags are self-closed (`<br />`, `<img ... />`)
   - attributes are lower-cased, quoted and not minimised (`nowrap="nowrap"`)
   - non-ASCII characters and named entities become numeric references (`&#160;`, `&#8220;`), so the output is 7-bit and survives any charset handling
   - MSO conditional comments are left untouched
4. **Lint.** Warnings appear in the HTML source view for missing alt text, buttons without links, relative or localhost image URLs, and a message size over 102 KB (Gmail's clipping limit).

**Strict XHTML 1.0 Transitional** is on by default in Email settings. In this mode the export leaves out `role="presentation"` and the VML/Office namespaces, because the XHTML 1.0 DTD doesn't define them. The output is also checked for well-formedness with `xmllint` in the test suite.

### Developer views
- **Visual editor**: the canvas, using the same renderer and CSS as the export.
- **HTML source**: live, syntax-highlighted output from the export engine, with its size, line count and warnings.
- **Preview**: the exported, inlined HTML in a sandboxed iframe, at desktop width or 375 px mobile.
- **Copy HTML** and **Download .html** are available in the top bar and in the source view.

## Architecture

```
server/
  index.js            HTTP entry point
  app.js              Express app: API + static hosting
  lib/exporter.js     render → juice → XHTML → lint
  lib/uploads.js      multer storage into YYYY/MM/ProjectName, listing, safe paths
shared/               ES modules used by BOTH the browser and Node
  blocks.js           block catalogue, defaults, inspector schemas, document model
  render.js           table-based renderer + class stylesheet (buildCss)
  paths.js            upload folder naming
public/
  index.html, css/app.css
  js/main.js          bootstrapping, palette, top bar, shortcuts
  js/store.js         document state, undo/redo, autosave
  js/canvas.js        canvas rendering, SortableJS, file drops
  js/rte.js           TinyMCE inline editors
  js/inspector.js     properties panel
  js/media.js         media library + picker modal + uploads
  js/source.js        HTML source / preview / copy / download
test/                 node:test suites (exporter, uploads, HTTP API)
```

The editor and the exporter share one renderer, so what you see on the canvas is the same markup that gets exported. The only difference is that the export is CSS-inlined. There is no front-end build step: the browser loads native ES modules, with TinyMCE and SortableJS served directly from `node_modules`.

### HTTP API

| Method & path | Description |
|---|---|
| `POST /api/uploads?project=Name` | multipart field `files` (up to 20). Returns `{ directory: "2026/11/Name", files: [{ url, path, name, size, ... }] }` |
| `GET /api/uploads[?project=Name]` | Lists images, newest first |
| `DELETE /api/uploads?path=YYYY/MM/Name/file.png` | Deletes one image |
| `POST /api/export` | Body `{ doc }`. Returns `{ html, bytes, warnings }`. Add `?download&filename=x.html` to get an attachment instead |
| `GET /api/config` | Effective public base URL |

## Using the output in Synergetic

1. Set **Asset base URL** in Email settings, or `PUBLIC_BASE_URL` on the server, to an address that recipients can reach.
2. Click **Copy HTML** and paste it into Synergetic's HTML or source editor, or upload the downloaded `.html` file.
3. Merge fields can go in any text or link. Links accept any non-script URL, including placeholder tokens.

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
