/**
 * Central document store with undo/redo history and localStorage autosave.
 *
 * Mutations go through update(fn, opts); listeners receive opts so views can
 * decide how much to re-render:
 *   { render: 'all' }               full canvas rebuild (structure/settings)
 *   { render: 'block', id }         single block rebuild (inspector props)
 *   { render: 'none' }              model-only (inline text typing)
 */
import { createDocument, normalizeDocument } from '/shared/blocks.js';
import { migrateStorageKey } from './ui.js';

const STORAGE_KEY = 'swiftwing.email.doc.v1';
migrateStorageKey('atelier.email.doc.v1', STORAGE_KEY);
const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeDocument(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt — start fresh */
  }
  return createDocument();
}

const listeners = new Set();
let saveTimer = null;

export const store = {
  doc: load(),
  selectedId: null,
  past: [],
  future: [],
  lastKey: null,
  lastTime: 0,

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  emit(event, opts = {}) {
    for (const fn of listeners) fn(event, opts);
  },

  /** Apply a mutation. opts.coalesce merges rapid edits of the same key into one undo step. */
  update(mutator, opts = {}) {
    const now = Date.now();
    const snapshot = JSON.stringify(this.doc);
    const coalesce = opts.coalesce && opts.coalesce === this.lastKey && now - this.lastTime < COALESCE_MS;
    if (!coalesce) {
      this.past.push(snapshot);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.future = [];
    this.lastKey = opts.coalesce || null;
    this.lastTime = now;
    mutator(this.doc);
    this.persist();
    this.emit('change', { render: 'all', ...opts });
  },

  replace(doc) {
    this.past.push(JSON.stringify(this.doc));
    this.future = [];
    this.doc = normalizeDocument(doc);
    this.selectedId = null;
    this.persist();
    this.emit('change', { render: 'all' });
    this.emit('select');
  },

  undo() {
    if (!this.past.length) return;
    this.future.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.past.pop());
    this.afterTimeTravel();
  },

  redo() {
    if (!this.future.length) return;
    this.past.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.future.pop());
    this.afterTimeTravel();
  },

  afterTimeTravel() {
    this.lastKey = null;
    if (this.selectedId && !this.getBlock(this.selectedId)) this.selectedId = null;
    this.persist();
    this.emit('change', { render: 'all' });
    this.emit('select');
  },

  select(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit('select');
  },

  getBlock(id) {
    return this.doc.blocks.find((b) => b.id === id) || null;
  },

  indexOf(id) {
    return this.doc.blocks.findIndex((b) => b.id === id);
  },

  persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.doc));
      } catch {
        /* quota or private mode — ignore */
      }
    }, 250);
  },
};
