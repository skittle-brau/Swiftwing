import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { exportEmail } from './lib/exporter.js';
import {
  createUploader, storeUpload, storeBuffer, listUploads, resolveInside, ensureDir, datedProjectDir, MAX_FILES,
} from './lib/uploads.js';
import { DEFAULT_MAX_WIDTH, DEFAULT_JPEG_QUALITY } from './lib/images.js';
import { openDatabase, defaultDbPath } from './lib/db.js';
import { AuthService } from './lib/auth.js';
import { authRouter, loadSession, requireLogin, sameOriginGuard } from './lib/http-auth.js';
import { TemplateStore, TemplateError } from './lib/templates.js';
import { parseVideoUrl, fetchVideoInfo, makeVideoThumbnail, VideoError } from './lib/video.js';

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && v !== '' && v != null ? Math.min(max, Math.max(min, n)) : fallback;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {object} [options]
 * @param {string} [options.uploadDir]      where images are stored
 * @param {string} [options.dbPath]         SQLite file (':memory:' for tests)
 * @param {string} [options.publicBaseUrl]  absolute origin used for exported image URLs
 * @param {() => Date} [options.now]        clock (injectable for tests)
 * @param {number} [options.maxImageWidth]  uploads wider than this are downscaled (default 1200)
 * @param {number} [options.jpegQuality]    JPEG quality 1–100 (default 82)
 * @param {string|boolean} [options.trustProxy] Express "trust proxy" setting
 * @param {object} [options.auth]           AuthService options (lockout, rate limits, session lengths)
 * @param {typeof fetch} [options.fetch]    fetch used for video thumbnails (injectable for tests)
 */
export function createApp(options = {}) {
  const uploadDir = path.resolve(options.uploadDir || process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
  const publicBaseUrl = (options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  ensureDir(uploadDir);

  const db = options.db || openDatabase(options.dbPath || (options.uploadDir ? ':memory:' : defaultDbPath(ROOT)));
  const auth = new AuthService(db, { ...(options.auth || {}) });
  const templates = new TemplateStore(db);
  const fetchImpl = options.fetch || globalThis.fetch;

  const app = express();
  app.disable('x-powered-by');
  // Behind Caddy: trust X-Forwarded-For/-Proto from private-network proxies so
  // rate limits see the real client IP and cookies get the Secure flag.
  app.set('trust proxy', options.trustProxy ?? process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
  app.locals.auth = auth;
  app.locals.db = db;

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });
  app.use(express.json({ limit: '5mb' }));
  app.use(loadSession(auth));
  app.use(requireLogin());
  app.use('/api', sameOriginGuard(publicBaseUrl));

  const originOf = (req) => publicBaseUrl || `${req.protocol}://${req.get('host')}`;
  const now = options.now || (() => new Date());
  const imageOptions = {
    maxWidth: clampInt(options.maxImageWidth ?? process.env.MAX_IMAGE_WIDTH, 100, 4000, DEFAULT_MAX_WIDTH),
    jpegQuality: clampInt(options.jpegQuality ?? process.env.JPEG_QUALITY, 1, 100, DEFAULT_JPEG_QUALITY),
  };

  /* ---------------------------------------------------------------- API */

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', authRouter(auth));

  app.get('/api/config', (req, res) => {
    res.json({ publicBaseUrl: originOf(req), configuredBaseUrl: publicBaseUrl || null, maxImageWidth: imageOptions.maxWidth });
  });

  const upload = createUploader();
  app.post('/api/uploads', upload.array('files', MAX_FILES), async (req, res, next) => {
    try {
      if (!req.files?.length) return res.status(400).json({ error: 'No files received (field name "files").' });
      const project = req.query.project ?? req.body?.project;
      const date = now();
      const files = [];
      // One at a time keeps memory use flat when several large photos arrive together.
      for (const f of req.files) {
        try {
          files.push(await storeUpload(uploadDir, f, { project, date, ...imageOptions }));
        } catch (err) {
          err.message = `${f.originalname}: ${err.message}`;
          throw err;
        }
      }
      res.status(201).json({ files, directory: datedProjectDir(project, date), maxWidth: imageOptions.maxWidth });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/uploads', async (req, res, next) => {
    try {
      res.json({ files: await listUploads(uploadDir, { project: req.query.project || undefined }) });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/uploads', async (req, res, next) => {
    try {
      const rel = String(req.query.path || '');
      const abs = rel && resolveInside(uploadDir, rel);
      if (!abs || !/^\d{4}\/\d{2}\/[^/]+\/[^/]+$/.test(rel)) return res.status(400).json({ error: 'Invalid path.' });
      await fs.unlink(abs);
      res.json({ deleted: rel });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found.' });
      next(err);
    }
  });

  /* ---------------------------------------------------------- templates */

  app.get('/api/templates', (req, res) => res.json({ templates: templates.list(req.user) }));
  app.get('/api/templates/:id', (req, res, next) => {
    try {
      res.json({ template: templates.get(req.params.id, req.user) });
    } catch (err) {
      next(err);
    }
  });
  app.post('/api/templates', (req, res, next) => {
    try {
      res.status(201).json({ template: templates.create(req.body || {}, req.user) });
    } catch (err) {
      next(err);
    }
  });
  app.put('/api/templates/:id', (req, res, next) => {
    try {
      res.json({ template: templates.update(req.params.id, req.body || {}, req.user) });
    } catch (err) {
      next(err);
    }
  });
  app.delete('/api/templates/:id', (req, res, next) => {
    try {
      templates.remove(req.params.id, req.user);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /* -------------------------------------------------------------- video */

  app.post('/api/video', async (req, res, next) => {
    try {
      const { url, project, style } = req.body || {};
      const video = parseVideoUrl(url);
      if (!video) throw new VideoError('Paste a YouTube or Vimeo link, e.g. https://www.youtube.com/watch?v=…');
      const info = await fetchVideoInfo(video, fetchImpl);
      const thumb = await makeVideoThumbnail(info.image, { letterboxed: info.letterboxed, style, ...imageOptions });
      const file = await storeBuffer(uploadDir, thumb.buffer, `video-${video.provider}-${video.id.toLowerCase()}.jpg`, { project, date: now() });
      res.status(201).json({ ...video, title: info.title, thumbnail: { ...file, width: thumb.width, height: thumb.height } });
    } catch (err) {
      next(err);
    }
  });

  /* ------------------------------------------------------------- export */

  app.post('/api/export', (req, res) => {
    const doc = req.body?.doc;
    if (!doc || !Array.isArray(doc.blocks)) return res.status(400).json({ error: 'Body must be { doc: { settings, blocks } }.' });
    const result = exportEmail(doc, { baseUrl: req.body.baseUrl || originOf(req) });
    if (req.query.download !== undefined) {
      const name = String(req.query.filename || 'email.html').replace(/[^\w.-]+/g, '-');
      res.set('Content-Disposition', `attachment; filename="${name}"`);
      return res.type('text/html; charset=utf-8').send(result.html);
    }
    res.json(result);
  });

  /* ------------------------------------------------------------- static */

  app.use('/uploads', express.static(uploadDir, { maxAge: '30d', immutable: true, index: false, dotfiles: 'deny' }));
  app.get('/login', (req, res) => {
    if (req.user) return res.redirect(302, '/');
    res.sendFile(path.join(ROOT, 'public', 'login.html'));
  });
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use('/vendor/tinymce', express.static(path.join(ROOT, 'node_modules/tinymce'), { maxAge: '7d' }));
  app.use('/vendor/sortablejs', express.static(path.join(ROOT, 'node_modules/sortablejs/modular'), { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html' }));

  /* ------------------------------------------------------------- errors */

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 25 MB limit.' : err.message });
    }
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
    const status = err.status || err.statusCode || 500;
    if (status >= 500 && !(err instanceof VideoError)) console.error(err);
    const expose = status < 500 || err instanceof VideoError || err instanceof TemplateError;
    res.status(status).json({ error: expose ? err.message : 'Internal server error.' });
  });

  return app;
}
