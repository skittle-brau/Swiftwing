import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultDbPath } from '../server/lib/db.js';

test('new installs use swiftwing.db; an existing atelier.db is kept', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'swiftwing-db-'));
  const saved = { UPLOAD_DIR: process.env.UPLOAD_DIR, DB_PATH: process.env.DB_PATH };
  try {
    delete process.env.DB_PATH;
    process.env.UPLOAD_DIR = path.join(dir, 'uploads');
    assert.equal(defaultDbPath('/app'), path.join(dir, 'swiftwing.db'));
    writeFileSync(path.join(dir, 'atelier.db'), '');
    assert.equal(defaultDbPath('/app'), path.join(dir, 'atelier.db'));
    process.env.DB_PATH = path.join(dir, 'custom.db');
    assert.equal(defaultDbPath('/app'), path.join(dir, 'custom.db'));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
