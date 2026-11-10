/**
 * Image asset storage.
 *
 * Files are written to  <UPLOAD_DIR>/YYYY/MM/<ProjectName>/<file>
 * e.g.                  uploads/2026/11/SpringNewsletter/hero-banner.png
 * and served publicly at /uploads/YYYY/MM/<ProjectName>/<file>.
 * Images are optimised (see images.js) before they are written.
 */
import fs from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { sanitizeProjectName, datedProjectDir } from '../../shared/paths.js';
import { optimizeImage } from './images.js';

export { sanitizeProjectName, datedProjectDir };

export const ALLOWED_TYPES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
};
const IMAGE_EXT = new Set(Object.values(ALLOWED_TYPES).flat());
// Phone photos are often 5–15 MB; they are downscaled before being stored.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 10;

/** "My Photo (1).JPG" → "my-photo-1.jpg" */
export function sanitizeFileName(original, mimetype) {
  const parsed = path.parse(String(original ?? '').replace(/\\/g, '/').split('/').pop() || '');
  let ext = parsed.ext.toLowerCase();
  const allowed = ALLOWED_TYPES[mimetype] || [];
  if (!allowed.includes(ext)) ext = allowed[0] || ext;
  if (ext === '.jpeg') ext = '.jpg';
  const base =
    parsed.name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'image';
  return base + ext;
}

/** Resolve a user-supplied relative path, refusing anything outside the upload root. */
export function resolveInside(root, rel) {
  const target = path.resolve(root, String(rel ?? '').replace(/^\/+/, ''));
  const rootResolved = path.resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) return null;
  return target;
}

/**
 * Write `buffer` as `fileName` in `dir`, adding -1, -2… if the name is taken.
 * Uses exclusive create so two simultaneous uploads can never overwrite each other.
 */
async function writeUnique(dir, fileName, buffer) {
  const { name, ext } = path.parse(fileName);
  for (let i = 0; i < 1000; i++) {
    const candidate = i ? `${name}-${i}${ext}` : fileName;
    try {
      await fs.writeFile(path.join(dir, candidate), buffer, { flag: 'wx' });
      return path.join(dir, candidate);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not find a free file name.');
}

/** Multer middleware: keeps files in memory so they can be optimised before saving. */
export function createUploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
    fileFilter(_req, file, cb) {
      if (!ALLOWED_TYPES[file.mimetype]) {
        const err = new Error(`Unsupported file type "${file.mimetype}". Use PNG, JPG, GIF or WebP.`);
        err.status = 415;
        return cb(err);
      }
      cb(null, true);
    },
  });
}

/**
 * Optimise one uploaded file and save it under YYYY/MM/<Project>/.
 * @returns descriptor for the API, including what optimisation did.
 */
export async function storeUpload(uploadRoot, file, { project, date = new Date(), maxWidth, jpegQuality } = {}) {
  const img = await optimizeImage(file.buffer, { maxWidth, jpegQuality });
  const relDir = datedProjectDir(project, date);
  const absDir = path.join(uploadRoot, relDir);
  await fs.mkdir(absDir, { recursive: true });
  const absPath = await writeUnique(absDir, sanitizeFileName(file.originalname, img.mime), img.buffer);
  return {
    ...describeFile(uploadRoot, absPath, await fs.stat(absPath)),
    width: img.width,
    height: img.height,
    optimized: {
      resized: img.resized,
      converted: img.converted,
      originalWidth: img.original.width,
      originalFormat: img.original.format,
      originalBytes: img.original.bytes,
    },
  };
}

export function describeFile(uploadRoot, absPath, stat) {
  const rel = path.relative(uploadRoot, absPath).split(path.sep).join('/');
  const [year, month, project] = rel.split('/');
  return {
    name: path.basename(absPath),
    path: rel,
    url: '/uploads/' + rel.split('/').map(encodeURIComponent).join('/'),
    year,
    month,
    project,
    size: stat.size,
    modified: stat.mtime.toISOString(),
  };
}

/** List images, newest first. Optional project filter (sanitised name). */
export async function listUploads(uploadRoot, { project } = {}) {
  const wanted = project ? sanitizeProjectName(project) : null;
  const out = [];
  const read = async (dir) => {
    try {
      return await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const y of await read(uploadRoot)) {
    if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue;
    for (const m of await read(path.join(uploadRoot, y.name))) {
      if (!m.isDirectory() || !/^\d{2}$/.test(m.name)) continue;
      for (const p of await read(path.join(uploadRoot, y.name, m.name))) {
        if (!p.isDirectory() || (wanted && p.name !== wanted)) continue;
        const dir = path.join(uploadRoot, y.name, m.name, p.name);
        for (const f of await read(dir)) {
          if (!f.isFile() || !IMAGE_EXT.has(path.extname(f.name).toLowerCase())) continue;
          const abs = path.join(dir, f.name);
          out.push(describeFile(uploadRoot, abs, await fs.stat(abs)));
        }
      }
    }
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}
