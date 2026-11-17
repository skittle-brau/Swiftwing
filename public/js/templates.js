/**
 * Templates menu: start from a saved template; save the current email as a
 * template; update or manage templates.
 *
 * Sharing levels: personal (only me), a group I belong to, or everyone.
 */
import { createDocument, DEFAULT_SETTINGS } from '/shared/blocks.js';
import { api } from './api.js';
import { session } from './account.js';
import { store } from './store.js';
import { migrateStorageKey, $, h, dropdown, menuItem, openDialog, promptDialog, toast, formatDate, ICONS } from './ui.js';

const KEY = 'swiftwing.template.v1';
migrateStorageKey('atelier.template.v1', KEY);
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

/* --------------------------------------------------------------- sharing */

/** Groups this user can share with: their own groups, or every group for admins. */
async function shareableGroups() {
  if (session.user?.role === 'admin') {
    try {
      return (await api.listGroups()).groups;
    } catch {
      /* fall back to own groups */
    }
  }
  return session.user?.groups || [];
}

async function shareOptions() {
  const groups = await shareableGroups();
  return [['user', 'Only me'], ...groups.map((g) => [`group:${g.id}`, `Group: ${g.name}`]), ['global', 'Everyone']];
}

const shareValue = (t) => (t.scope === 'group' ? `group:${t.groupId}` : t.scope);

function parseShare(v) {
  const [scope, id] = String(v).split(':');
  return scope === 'group' ? { scope, groupId: Number(id) } : { scope };
}

export function shareLabel(t) {
  if (t.scope === 'global') return 'Everyone';
  if (t.scope === 'group') return `Group: ${t.groupName || '?'}`;
  return 'Personal';
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
    intro: 'Saves the current email so you (or the people you share it with) can start from it. Images stay where they are.',
    fields: [
      { name: 'name', label: 'Template name', value: '' },
      { name: 'description', label: 'Description (optional)', type: 'textarea' },
      { name: 'share', label: 'Share with', type: 'select', options: await shareOptions(), value: 'user', help: 'You can change this later in Manage templates.' },
    ],
    validate: async (v) => {
      if (!v.name.trim()) return 'Give the template a name.';
      try {
        const { template } = await api.createTemplate({ name: v.name, description: v.description, doc: store.doc, ...parseShare(v.share) });
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
  const isAdmin = session.user?.role === 'admin';
  let showAll = false;
  const options = await shareOptions();
  const draw = async () => {
    const { templates } = await api.listTemplates(showAll);
    const allToggle = isAdmin
      ? h(
          'label',
          { class: 'app-checkbox app-manage-all' },
          Object.assign(h('input', { type: 'checkbox', onchange: (e) => { showAll = e.target.checked; draw(); } }), { checked: showAll }),
          'Show every template, including other people’s personal ones (admin)',
        )
      : null;
    if (!templates.length) {
      body.replaceChildren(allToggle || '', h('p', { class: 'app-dialog-intro' }, 'No templates yet. Use “Save as new template…” to create one.'));
      return;
    }
    const sharing = (t) => {
      if (!t.canEdit) return h('span', { class: 'app-muted' }, shareLabel(t));
      // "Only me" reads wrongly on someone else's template (an admin's view): name the owner instead.
      const label = (v, l) => (v === 'user' && !t.mine ? `Personal (${t.owner || 'owner'})` : l);
      const sel = h('select', { 'aria-label': `Sharing for ${t.name}` }, options.map(([v, l]) => h('option', { value: v }, label(v, l))));
      // Keep the current value even if it's a group this person isn't in (e.g. an admin viewing).
      if (![...sel.options].some((o) => o.value === shareValue(t))) sel.append(h('option', { value: shareValue(t) }, shareLabel(t)));
      sel.value = shareValue(t);
      sel.addEventListener('change', async () => {
        try {
          await api.updateTemplate(t.id, parseShare(sel.value));
          toast(`“${t.name}” is now shared with: ${sel.selectedOptions[0].textContent}`);
          draw();
        } catch (err) {
          sel.value = shareValue(t);
          toast(err.message, { error: true });
        }
      });
      return sel;
    };
    body.replaceChildren(
      ...(allToggle ? [allToggle] : []),
      h(
        'table',
        { class: 'app-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Shared with'), h('th', {}, 'Owner'), h('th', {}, 'Last updated'), h('th', {}))),
        h(
          'tbody',
          {},
          templates.map((t) =>
            h(
              'tr',
              {},
              h('td', {}, h('strong', {}, t.name), t.description ? h('div', { class: 'app-muted' }, t.description) : null),
              h('td', {}, sharing(t)),
              h('td', { class: 'app-muted' }, t.mine ? 'You' : t.owner ? `${t.owner}${t.ownerRemoved ? ' (removed)' : ''}` : '—'),
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
                        const who = t.scope === 'global' ? ' for everyone' : t.scope === 'group' ? ` for ${t.groupName || 'the group'}` : '';
                        if (!confirm(`Delete the template “${t.name}”${who}? This can't be undone.`)) return;
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
      h(
        'p',
        { class: 'app-dialog-intro' },
        'Personal templates are only visible to you; group templates to members of that group; “Everyone” templates to all staff. Only a template’s owner, or an admin, can change, re-share or delete it.',
      ),
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
      );
      const holder = h('div', { class: 'app-menu-scroll' }, h('div', { class: 'app-menu-empty' }, 'Loading…'));
      list.append(holder);
      list.append(h('hr'), menuItem('Save as new template…', act(saveAsNew)));
      if (current) list.append(menuItem(`Update “${current.name}”`, act(updateCurrent), { sub: 'Overwrite it with the current email' }));
      list.append(menuItem('Manage templates…', act(manage)));
      try {
        const { templates } = await api.listTemplates();
        // Sections: my personal templates, then each group, then everyone's.
        const sections = new Map([['My templates', []]]);
        for (const t of templates) {
          const key = t.scope === 'user' ? 'My templates' : t.scope === 'group' ? `Group: ${t.groupName || '?'}` : 'Everyone';
          if (!sections.has(key)) sections.set(key, []);
          sections.get(key).push(t);
        }
        const everyone = sections.get('Everyone');
        sections.delete('Everyone');
        if (everyone) sections.set('Everyone', everyone);
        const items = [];
        for (const [label, list2] of sections) {
          if (!list2.length) continue;
          items.push(h('div', { class: 'app-menu-label' }, label));
          for (const t of list2) {
            const by = !t.mine && t.owner ? `by ${t.owner} · ` : '';
            items.push(
              menuItem(t.name, act(() => loadTemplate(t)), {
                sub: t.description || `${by}updated ${formatDate(t.updatedAt)}`,
                current: current?.id === t.id,
              }),
            );
          }
        }
        holder.replaceChildren(...(items.length ? items : [h('div', { class: 'app-menu-label' }, 'Saved templates'), h('div', { class: 'app-menu-empty' }, 'No templates yet')]));
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
