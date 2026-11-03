import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeProjectName, sanitizeFileName, datedProjectDir, resolveInside } from '../server/lib/uploads.js';

test('builds YYYY/MM/ProjectName directories', () => {
  assert.equal(datedProjectDir('ProjectName', new Date(2026, 10, 3)), '2026/11/ProjectName');
  assert.equal(datedProjectDir('Spring Newsletter', new Date(2027, 0, 15)), '2027/01/Spring-Newsletter');
});

test('sanitises project names into a single safe path segment', () => {
  assert.equal(sanitizeProjectName('../../etc/passwd'), 'etcpasswd');
  assert.equal(sanitizeProjectName('  Année 2026 — Gala!  '), 'Annee-2026-Gala');
  assert.equal(sanitizeProjectName(''), 'Untitled');
  assert.equal(sanitizeProjectName('...'), 'Untitled');
});

test('sanitises file names and enforces an extension matching the MIME type', () => {
  assert.equal(sanitizeFileName('My Photo (1).JPG', 'image/jpeg'), 'my-photo-1.jpg');
  assert.equal(sanitizeFileName('../../evil.php', 'image/png'), 'evil.png');
  assert.equal(sanitizeFileName('C:\\Users\\me\\logo.png', 'image/png'), 'logo.png');
});

test('resolveInside blocks path traversal', () => {
  assert.equal(resolveInside('/srv/uploads', '../secret'), null);
  assert.equal(resolveInside('/srv/uploads', '2026/11/X/a.png'), '/srv/uploads/2026/11/X/a.png');
});
