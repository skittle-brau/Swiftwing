/**
 * Staff groups (e.g. "Junior School", "Marketing"). Admins create groups and
 * assign users to them; a user can belong to several. Members can share
 * templates with a group they belong to.
 */
export class GroupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cleanName(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!n) throw new GroupError('Give the group a name.');
  if (n.length > 60) throw new GroupError('Group names can be at most 60 characters.');
  return n;
}

export class GroupStore {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
  }

  list() {
    return this.db
      .prepare(
        `SELECT g.id, g.name, g.created_at,
                (SELECT COUNT(*) FROM user_groups ug WHERE ug.group_id = g.id) AS members,
                (SELECT COUNT(*) FROM templates t WHERE t.scope = 'group' AND t.group_id = g.id) AS templates
         FROM groups g ORDER BY g.name COLLATE NOCASE`,
      )
      .all()
      .map((g) => ({ id: g.id, name: g.name, members: g.members, templates: g.templates, createdAt: g.created_at }));
  }

  get(id) {
    const g = this.db.prepare('SELECT id, name FROM groups WHERE id = ?').get(Number(id));
    if (!g) throw new GroupError('Group not found.', 404);
    return { id: g.id, name: g.name };
  }

  create(name) {
    const n = cleanName(name);
    try {
      const { lastInsertRowid } = this.db.prepare('INSERT INTO groups (name, created_at) VALUES (?, ?)').run(n, this.now());
      return this.get(Number(lastInsertRowid));
    } catch (err) {
      if (/UNIQUE/.test(err.message)) throw new GroupError(`A group called "${n}" already exists.`, 409);
      throw err;
    }
  }

  rename(id, name) {
    this.get(id);
    const n = cleanName(name);
    try {
      this.db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(n, Number(id));
    } catch (err) {
      if (/UNIQUE/.test(err.message)) throw new GroupError(`A group called "${n}" already exists.`, 409);
      throw err;
    }
    return this.get(id);
  }

  /** Delete a group. Its templates become personal templates of their owners, so nothing disappears. */
  remove(id) {
    const g = this.get(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE templates SET scope = 'user', group_id = NULL WHERE scope = 'group' AND group_id = ?").run(g.id);
      this.db.prepare('DELETE FROM groups WHERE id = ?').run(g.id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return g;
  }

  /** Groups a user belongs to. */
  groupsOf(userId) {
    return this.db
      .prepare('SELECT g.id, g.name FROM groups g JOIN user_groups ug ON ug.group_id = g.id WHERE ug.user_id = ? ORDER BY g.name COLLATE NOCASE')
      .all(Number(userId))
      .map((g) => ({ id: g.id, name: g.name }));
  }

  isMember(userId, groupId) {
    return !!this.db.prepare('SELECT 1 FROM user_groups WHERE user_id = ? AND group_id = ?').get(Number(userId), Number(groupId));
  }

  /** Replace a user's group memberships. */
  setUserGroups(userId, groupIds) {
    const ids = [...new Set((Array.isArray(groupIds) ? groupIds : []).map(Number))];
    for (const id of ids) this.get(id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM user_groups WHERE user_id = ?').run(Number(userId));
      const add = this.db.prepare('INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)');
      for (const id of ids) add.run(Number(userId), id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.groupsOf(userId);
  }
}
