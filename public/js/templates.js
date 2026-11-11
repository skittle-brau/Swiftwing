/**
 * Templates menu: start from a saved, shared template; save the current email
 * as a template; update or manage templates.
 */
import { createDocument, DEFAULT_SETTINGS } from '/shared/blocks.js';
import { api } from './api.js';
import { store } from './store.js';
import { $, h, dropdown, menuItem, openDialog, promptDialog, toast, formatDate, ICONS } from './ui.js';

const KEY = 'atelier.template.v1';
let current = load(); // { id, name } of the template the current email came from

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}
function remember(t) {
  current = t ? { id: t.id, name: t.name } : null;
  try {
    if (current) localStorage.setItem(KEY, JSON.stringify(current));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  updateButton();
}
function updateButton() {
  const btn = $('#btn-templates');
  btn.textContent = 'Templates ▾';
  btn.title = current ? `Started from template “${current.name}”` : 'Templates';
}

/** Replace the editor's email, keeping the current project name (it decides the upload folder). */
function useDocument(doc) {
  const projectName = store.doc.settings.projectName;
  store.replace({ ...doc, settings: { ...doc.settings, projectName } });
}

function confirmReplace(what) {
  return confirm(`Replace the current email with ${what}?\n\nYou can undo this with Ctrl+Z (⌘Z).`);
}

async function loadTemplate(t) {
  if (!confirmReplace(`the template “${t.name}”`)) return;
  try {
    const { template } = await api.getTemplate(t.id);
    useDocument(template.doc);
    remember(template);
    toast(`Loaded template “${template.name}”`);
  } catch (err) {
    toast(err.message, { error: true });
  }
}

async function saveAsNew() {
  const values = await promptDialog({
    title: 'Save as template',
    submitLabel: 'Save template',
    intro: 'Saves the current email so everyone can start from it. Images stay where they are.',
    fields: [
      { name: 'name', label: 'Template name', value: '' },
      { name: 'description', label: 'Description (optional)', type: 'textarea' },
    ],
    validate: async (v) => {
      if (!v.name.trim()) return 'Give the template a name.';
      try {
        const { template } = await api.createTemplate({ name: v.name, description: v.description, doc: store.doc });
        remember(template);
      } catch (err) {
        return err.message;
      }
      return null;
    },
  });
  if (values) toast(`Saved template “${values.name.trim()}”`);
}

async function updateCurrent() {
  if (!current) return;
  if (!confirm(`Overwrite the template “${current.name}” with the current email?`)) return;
  try {
    const { template } = await api.updateTemplate(current.id, { doc: store.doc });
    remember(template);
    toast(`Updated template “${template.name}”`);
  } catch (err) {
    toast(err.message, { error: true });
  }
}

async function manage() {
  const body = h('div');
  const draw = async () => {
    const { templates } = await api.listTemplates();
    if (!templates.length) {
      body.replaceChildren(h('p', { class: 'app-dialog-intro' }, 'No templates yet. Use “Save as new template…” to create one.'));
      return;
    }
    body.replaceChildren(
      h(
        'table',
        { class: 'app-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Created by'), h('th', {}, 'Last updated'), h('th', {}))),
        h(
          'tbody',
          {},
          templates.map((t) =>
            h(
              'tr',
              {},
              h('td', {}, h('strong', {}, t.name), t.description ? h('div', { class: 'app-muted' }, t.description) : null),
              h('td', { class: 'app-muted' }, t.createdBy || '—'),
              h('td', { class: 'app-muted' }, `${formatDate(t.updatedAt)}${t.updatedBy ? ` by ${t.updatedBy}` : ''}`),
              h(
                'td',
                { class: 'app-actions' },
                h('button', { type: 'button', class: 'app-btn app-btn-sm', onclick: () => loadTemplate(t) }, 'Use'),
                ' ',
                t.canEdit ? h('button', { type: 'button', class: 'app-btn app-btn-sm', onclick: () => rename(t, draw) }, 'Rename') : null,
                ' ',
                t.canEdit
                  ? h('button', {
                      type: 'button',
                      class: 'app-icon-btn',
                      title: `Delete ${t.name}`,
                      'aria-label': `Delete ${t.name}`,
                      html: ICONS.trash,
                      onclick: async () => {
                        if (!confirm(`Delete the template “${t.name}” for everyone? This can't be undone.`)) return;
                        try {
                          await api.deleteTemplate(t.id);
                          if (current?.id === t.id) remember(null);
                          toast(`Deleted “${t.name}”`);
                          draw();
                        } catch (err) {
                          toast(err.message, { error: true });
                        }
                      },
                    })
                  : null,
              ),
            ),
          ),
        ),
      ),
      h('p', { class: 'app-dialog-intro' }, 'Templates are shared with everyone. Only the person who created a template, or an admin, can rename, update or delete it.'),
    );
  };
  await draw();
  openDialog({ title: 'Templates', body, wide: true });
}

async function rename(t, redraw) {
  const values = await promptDialog({
    title: 'Rename template',
    fields: [
      { name: 'name', label: 'Template name', value: t.name },
      { name: 'description', label: 'Description (optional)', type: 'textarea', value: t.description },
    ],
    validate: async (v) => {
      try {
        const { template } = await api.updateTemplate(t.id, { name: v.name, description: v.description });
        if (current?.id === t.id) remember(template);
      } catch (err) {
        return err.message;
      }
      return null;
    },
  });
  if (values) redraw();
}

export function initTemplates() {
  updateButton();
  dropdown(
    $('#btn-templates'),
    async (list, close) => {
      const act = (fn) => () => {
        close();
        fn();
      };
      list.append(
        h('div', { class: 'app-menu-label' }, 'Start from'),
        menuItem('Blank email', act(() => {
          if (!confirmReplace('a blank email')) return;
          useDocument({ settings: { ...DEFAULT_SETTINGS }, blocks: [] });
          remember(null);
        })),
        menuItem('Starter layout', act(() => {
          if (!confirmReplace('the starter layout')) return;
          useDocument(createDocument());
          remember(null);
        })),
        h('div', { class: 'app-menu-label' }, 'Saved templates'),
      );
      const holder = h('div', { class: 'app-menu-scroll' }, h('div', { class: 'app-menu-empty' }, 'Loading…'));
      list.append(holder);
      list.append(h('hr'), menuItem('Save as new template…', act(saveAsNew)));
      if (current) list.append(menuItem(`Update “${current.name}”`, act(updateCurrent), { sub: 'Overwrite it with the current email' }));
      list.append(menuItem('Manage templates…', act(manage)));
      try {
        const { templates } = await api.listTemplates();
        holder.replaceChildren(
          ...(templates.length
            ? templates.map((t) =>
                menuItem(t.name, act(() => loadTemplate(t)), {
                  sub: t.description || `Updated ${formatDate(t.updatedAt)}${t.updatedBy ? ` by ${t.updatedBy}` : ''}`,
                  current: current?.id === t.id,
                }),
              )
            : [h('div', { class: 'app-menu-empty' }, 'No templates yet')]),
        );
        // Hide "Update" when this user can't edit the current template.
        const cur = templates.find((t) => t.id === current?.id);
        if (current && (!cur || !cur.canEdit)) {
          [...list.querySelectorAll('button')].find((b) => b.textContent.startsWith('Update “'))?.remove();
          if (!cur) remember(null);
        }
      } catch (err) {
        holder.replaceChildren(h('div', { class: 'app-menu-empty' }, err.message));
      }
    },
    { wide: true },
  );
}
