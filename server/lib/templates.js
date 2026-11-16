/**
 * Email templates stored on the server and shared by all users.
 * Anyone logged in can use and create templates; only the creator or an
 * admin can overwrite, rename or delete one.
 */
import { normalizeDocument } from '../../shared/blocks.js';

export const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;

export class TemplateError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cleanName(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) throw new TemplateError('Give the template a name.');
  if (n.length > 80) throw new TemplateError('Template names can be at most 80 characters.');
  return n;
}

function cleanDoc(doc) {
  if (!doc || !Array.isArray(doc.blocks)) throw new TemplateError('Template must contain an email design.');
  const normalized = normalizeDocument(doc);
  const json = JSON.stringify(normalized);
  if (Buffer.byteLength(json) > MAX_TEMPLATE_BYTES) throw new TemplateError('Template is too large (over 2 MB).', 413);
  return json;
}

export class TemplateStore {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
  }

  canEdit(row, user) {
    return user?.role === 'admin' || (row.created_by != null && row.created_by === user?.id);
  }

  list(user) {
    return this.db
      .prepare(
        `SELECT t.id, t.name, t.description, t.created_by, t.created_at, t.updated_at,
                c.username AS created_by_name, u.username AS updated_by_name
         FROM templates t
         LEFT JOIN users c ON c.id = t.created_by
         LEFT JOIN users u ON u.id = t.updated_by
         ORDER BY t.name COLLATE NOCASE`,
      )
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        createdBy: r.created_by_name,
        updatedBy: r.updated_by_name,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        canEdit: this.canEdit(r, user),
      }));
  }

  row(id) {
    const r = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(Number(id));
    if (!r) throw new TemplateError('Template not found.', 404);
    return r;
  }

  get(id, user) {
    const r = this.row(id);
    return { id: r.id, name: r.name, description: r.description, doc: JSON.parse(r.doc), updatedAt: r.updated_at, canEdit: this.canEdit(r, user) };
  }

  create({ name, description = '', doc }, user) {
    const n = cleanName(name);
    const json = cleanDoc(doc);
    const now = this.now();
    try {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO templates (name, description, doc, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(n, String(description).slice(0, 500), json, user.id, user.id, now, now);
      return this.get(Number(lastInsertRowid), user);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) throw new TemplateError(`A template called "${n}" already exists.`, 409);
      throw err;
    }
  }

  update(id, { name, description, doc }, user) {
    const r = this.row(id);
    if (!this.canEdit(r, user)) throw new TemplateError('Only the person who created this template, or an admin, can change it.', 403);
    const next = {
      name: name !== undefined ? cleanName(name) : r.name,
      description: description !== undefined ? String(description).slice(0, 500) : r.description,
      doc: doc !== undefined ? cleanDoc(doc) : r.doc,
    };
    try {
      this.db
        .prepare('UPDATE templates SET name = ?, description = ?, doc = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(next.name, next.description, next.doc, user.id, this.now(), r.id);
    } catch (err) {
      if (/UNIQUE/.test(err.message)) throw new TemplateError(`A template called "${next.name}" already exists.`, 409);
      throw err;
    }
    return this.get(r.id, user);
  }

  /** Names of templates whose design refers to images under /uploads/<folder>/. */
  usingFolder(folder) {
    const like = `%/uploads/${folder.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
    return this.db
      .prepare("SELECT name FROM templates WHERE doc LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE")
      .all(like)
      .map((r) => r.name);
  }

  remove(id, user) {
    const r = this.row(id);
    if (!this.canEdit(r, user)) throw new TemplateError('Only the person who created this template, or an admin, can delete it.', 403);
    this.db.prepare('DELETE FROM templates WHERE id = ?').run(r.id);
  }
}
