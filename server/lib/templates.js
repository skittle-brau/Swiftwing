/**
 * Email templates stored on the server, at three levels:
 *
 *   global  visible to everyone
 *   group   visible to members of one group
 *   user    visible only to the person who made it ("personal")
 *
 * The owner (or an admin) can edit, re-share or delete a template. Admins can
 * see every template, including personal templates of users who have been
 * removed, and can download any person's templates as a .zip archive.
 */
import { normalizeDocument } from '../../shared/blocks.js';
import { createZip } from './zip.js';

export const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;
export const SCOPES = ['global', 'group', 'user'];

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

/** Safe, unique file names inside an archive. */
function fileNames(names) {
  const seen = new Map();
  return names.map((n) => {
    const base = String(n).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'template';
    const k = base.toLowerCase();
    const count = (seen.get(k) || 0) + 1;
    seen.set(k, count);
    return `${count > 1 ? `${base}-${count}` : base}.json`;
  });
}

const SELECT = `
  SELECT t.*, g.name AS group_name, u.username AS updated_by_name
  FROM templates t
  LEFT JOIN groups g ON g.id = t.group_id
  LEFT JOIN users u ON u.id = t.updated_by`;

export class TemplateStore {
  /** @param {import('node:sqlite').DatabaseSync} db @param {{groups: import('./groups.js').GroupStore}} opts */
  constructor(db, { groups, now = () => Date.now() } = {}) {
    this.db = db;
    this.groups = groups;
    this.now = now;
  }

  isOwner(row, user) {
    return row.created_by != null && row.created_by === user?.id;
  }

  canEdit(row, user) {
    return user?.role === 'admin' || this.isOwner(row, user);
  }

  canSee(row, user) {
    if (user?.role === 'admin' || row.scope === 'global' || this.isOwner(row, user)) return true;
    return row.scope === 'group' && row.group_id != null && this.groups.isMember(user.id, row.group_id);
  }

  describe(r, user) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      scope: r.scope,
      groupId: r.group_id,
      groupName: r.group_name || null,
      owner: r.owner_username || null,
      ownerRemoved: r.created_by == null && !!r.owner_username,
      updatedBy: r.updated_by_name || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      mine: this.isOwner(r, user),
      canEdit: this.canEdit(r, user),
    };
  }

  /**
   * Templates the user can see: global, their groups' and their own.
   * With `all` (admins only), every template, including removed users' personal ones.
   */
  list(user, { all = false } = {}) {
    const rows = this.db.prepare(`${SELECT} ORDER BY t.name COLLATE NOCASE`).all();
    const everything = all && user?.role === 'admin';
    return rows
      .filter((r) => (everything ? true : r.scope === 'global' || this.isOwner(r, user) || (r.scope === 'group' && r.group_id != null && this.groups.isMember(user.id, r.group_id))))
      .map((r) => this.describe(r, user));
  }

  row(id, user) {
    const r = this.db.prepare(`${SELECT} WHERE t.id = ?`).get(Number(id));
    // Templates the user can't see are reported as missing, rather than revealing they exist.
    if (!r || (user && !this.canSee(r, user))) throw new TemplateError('Template not found.', 404);
    return r;
  }

  get(id, user) {
    const r = this.row(id, user);
    return { ...this.describe(r, user), doc: JSON.parse(r.doc) };
  }

  /** Check a requested sharing level. Members can share to their own groups; admins to any. */
  sharing(scope, groupId, user) {
    const s = scope === undefined ? 'user' : scope;
    if (!SCOPES.includes(s)) throw new TemplateError('Sharing must be global, group or user.');
    if (s !== 'group') return { scope: s, groupId: null };
    if (groupId == null || groupId === '') throw new TemplateError('Choose which group to share with.');
    const g = this.groups.get(groupId);
    if (user.role !== 'admin' && !this.groups.isMember(user.id, g.id)) {
      throw new TemplateError('You can only share with groups you belong to.', 403);
    }
    return { scope: 'group', groupId: g.id };
  }

  assertNameFree(name, ownerId, exceptId = 0) {
    const clash = this.db
      .prepare('SELECT 1 FROM templates WHERE name = ? COLLATE NOCASE AND created_by IS ? AND id != ?')
      .get(name, ownerId ?? null, exceptId);
    if (clash) throw new TemplateError(`You already have a template called "${name}".`, 409);
  }

  create({ name, description = '', doc, scope, groupId }, user) {
    const n = cleanName(name);
    const json = cleanDoc(doc);
    const share = this.sharing(scope, groupId, user);
    this.assertNameFree(n, user.id);
    const now = this.now();
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO templates (name, description, doc, scope, group_id, created_by, owner_username, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(n, String(description).slice(0, 500), json, share.scope, share.groupId, user.id, user.username, user.id, now, now);
    return this.get(Number(lastInsertRowid), user);
  }

  update(id, { name, description, doc, scope, groupId }, user) {
    const r = this.row(id, user);
    if (!this.canEdit(r, user)) throw new TemplateError('Only the person who created this template, or an admin, can change it.', 403);
    const next = {
      name: name !== undefined ? cleanName(name) : r.name,
      description: description !== undefined ? String(description).slice(0, 500) : r.description,
      doc: doc !== undefined ? cleanDoc(doc) : r.doc,
      ...(scope !== undefined ? this.sharing(scope, groupId, user) : { scope: r.scope, groupId: r.group_id }),
    };
    if (name !== undefined) this.assertNameFree(next.name, r.created_by, r.id);
    this.db
      .prepare('UPDATE templates SET name = ?, description = ?, doc = ?, scope = ?, group_id = ?, updated_by = ?, updated_at = ? WHERE id = ?')
      .run(next.name, next.description, next.doc, next.scope, next.groupId, user.id, this.now(), r.id);
    return this.get(r.id, user);
  }

  remove(id, user) {
    const r = this.row(id, user);
    if (!this.canEdit(r, user)) throw new TemplateError('Only the person who created this template, or an admin, can delete it.', 403);
    this.db.prepare('DELETE FROM templates WHERE id = ?').run(r.id);
  }

  /** How many templates a person owns, by sharing level. */
  countByOwner(username) {
    const counts = { total: 0, global: 0, group: 0, user: 0 };
    for (const r of this.db.prepare('SELECT scope, COUNT(*) AS n FROM templates WHERE owner_username = ? COLLATE NOCASE GROUP BY scope').all(String(username))) {
      counts[r.scope] = r.n;
      counts.total += r.n;
    }
    return counts;
  }

  /** People who own templates but no longer have an account. */
  removedOwners() {
    return this.db
      .prepare(
        `SELECT owner_username AS username, COUNT(*) AS templates FROM templates
         WHERE created_by IS NULL AND owner_username IS NOT NULL
         GROUP BY owner_username COLLATE NOCASE ORDER BY owner_username COLLATE NOCASE`,
      )
      .all()
      .map((r) => ({ username: r.username, templates: r.templates }));
  }

  /**
   * A .zip of every template a person owns (works after their account is
   * removed). Each design opens with File → Open design; index.json lists
   * names, sharing and dates.
   */
  archive(username) {
    const rows = this.db.prepare(`${SELECT} WHERE t.owner_username = ? COLLATE NOCASE ORDER BY t.name COLLATE NOCASE`).all(String(username));
    const names = fileNames(rows.map((r) => r.name));
    const index = rows.map((r, i) => ({
      file: names[i],
      name: r.name,
      description: r.description,
      sharing: r.scope === 'group' ? `group: ${r.group_name || '(deleted group)'}` : r.scope === 'user' ? 'personal' : 'global',
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
    const zip = createZip([
      { name: 'index.json', data: JSON.stringify({ owner: username, exportedAt: new Date(this.now()).toISOString(), templates: index }, null, 2) },
      ...rows.map((r, i) => ({ name: names[i], data: JSON.stringify(JSON.parse(r.doc), null, 2), date: new Date(r.updated_at) })),
    ]);
    return { zip, count: rows.length };
  }

  /** Names of templates whose design refers to images under /uploads/<folder>/. */
  usingFolder(folder) {
    const like = `%/uploads/${folder.replace(/[\\%_]/g, (c) => `\\${c}`)}/%`;
    return this.db
      .prepare("SELECT name FROM templates WHERE doc LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE")
      .all(like)
      .map((r) => r.name);
  }
}
