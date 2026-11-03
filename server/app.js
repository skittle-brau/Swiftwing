import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { exportEmail } from './lib/exporter.js';
import { createUploader, describeFile, listUploads, resolveInside, ensureDir } from './lib/uploads.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {object} [options]
 * @param {string} [options.uploadDir]      where images are stored
 * @param {string} [options.publicBaseUrl]  absolute origin used for exported image URLs
 * @param {() => Date} [options.now]        clock (injectable for tests)
 */
export function createApp(options = {}) {
  const uploadDir = path.resolve(options.uploadDir || process.env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
  const publicBaseUrl = (options.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  ensureDir(uploadDir);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));

  const originOf = (req) => publicBaseUrl || `${req.protocol}://${req.get('host')}`;

  /* ---------------------------------------------------------------- API */

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.get('/api/config', (req, res) => {
    res.json({ publicBaseUrl: originOf(req), configuredBaseUrl: publicBaseUrl || null });
  });

  const upload = createUploader(uploadDir, { now: options.now });
  app.post('/api/uploads', upload.array('files', 20), async (req, res, next) => {
    try {
      const files = await Promise.all(
        (req.files || []).map(async (f) => describeFile(uploadDir, f.path, await fs.stat(f.path))),
      );
      if (!files.length) return res.status(400).json({ error: 'No files received (field name "files").' });
      res.status(201).json({ files, directory: req.uploadRelDir });
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
  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use('/vendor/tinymce', express.static(path.join(ROOT, 'node_modules/tinymce'), { maxAge: '7d' }));
  app.use('/vendor/sortablejs', express.static(path.join(ROOT, 'node_modules/sortablejs/modular'), { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT, 'public')));

  /* ------------------------------------------------------------- errors */

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 10 MB limit.' : err.message });
    }
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Internal server error.' : err.message });
  });

  return app;
}
