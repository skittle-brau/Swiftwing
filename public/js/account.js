/**
 * Signed-in user menu: change password, manage users (admins), log out.
 */
import { api } from './api.js';
import { $, h, dropdown, menuItem, openDialog, promptDialog, toast, formatDate, ICONS } from './ui.js';

export const session = { user: null };

const PASSWORD_HELP = 'At least 12 characters. A few random words is easy to remember and hard to guess.';

export async function initAccount() {
  const { user } = await api.me();
  session.user = user;
  const btn = $('#btn-user');
  btn.textContent = `${user.username} ▾`;
  btn.title = `Signed in as ${user.username} (${user.role})`;
  dropdown(btn, (list, close) => {
    list.append(
      ...[
        h('div', { class: 'app-menu-label' }, `${user.username} · ${user.role}`),
        menuItem('Change password…', () => (close(), changePassword())),
        user.role === 'admin' ? menuItem('Manage users…', () => (close(), manageUsers())) : null,
        h('hr'),
        menuItem('Log out', async () => {
          await api.logout().catch(() => {});
          location.href = '/login';
        }),
      ].filter(Boolean),
    );
  });
  return user;
}

async function changePassword() {
  const values = await promptDialog({
    title: 'Change password',
    submitLabel: 'Change password',
    fields: [
      { name: 'current', label: 'Current password', type: 'password', autocomplete: 'current-password' },
      { name: 'next', label: 'New password', type: 'password', autocomplete: 'new-password', help: PASSWORD_HELP },
      { name: 'repeat', label: 'Repeat new password', type: 'password', autocomplete: 'new-password' },
    ],
    validate: async (v) => {
      if (v.next !== v.repeat) return 'The new passwords do not match.';
      try {
        await api.changePassword(v.current, v.next);
      } catch (err) {
        return err.message;
      }
      return null;
    },
  });
  if (values) toast('Password changed. Your other sessions have been signed out.');
}

function downloadUrl(url) {
  const a = h('a', { href: url, download: '' });
  document.body.append(a);
  a.click();
  a.remove();
}

/** "3 templates (2 personal, 1 shared with everyone)" */
const countText = (c) => {
  const parts = [c.user && `${c.user} personal`, c.group && `${c.group} shared with a group`, c.global && `${c.global} shared with everyone`].filter(Boolean);
  return `${c.total} template${c.total === 1 ? '' : 's'} (${parts.join(', ')})`;
};

/** Tick the groups a user belongs to. */
async function editUserGroups(u, allGroups, after) {
  if (!allGroups.length) {
    toast('Create a group first (under Groups below).');
    return;
  }
  const mine = new Set(u.groups.map((g) => g.id));
  const boxes = allGroups.map((g) => {
    const cb = h('input', { type: 'checkbox', id: `ug-${g.id}`, value: String(g.id) });
    cb.checked = mine.has(g.id);
    return h('label', { class: 'app-checkbox', for: `ug-${g.id}` }, cb, g.name);
  });
  openDialog({
    title: `Groups for ${u.username}`,
    body: h('div', { class: 'app-form app-form-dialog' }, h('p', { class: 'app-dialog-intro' }, 'Members see templates shared with their groups and can share their own templates with them.'), ...boxes),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Save',
        kind: 'primary',
        onClick: async () => {
          const ids = boxes.map((b) => b.querySelector('input')).filter((cb) => cb.checked).map((cb) => Number(cb.value));
          try {
            const { groups } = await api.setUserGroups(u.id, ids);
            if (u.id === session.user.id) session.user.groups = groups;
            toast(`Updated groups for ${u.username}.`);
            after();
          } catch (err) {
            toast(err.message, { error: true });
            return false;
          }
          return true;
        },
      },
    ],
  });
}

/** Remove a user, offering their templates as a .zip first. */
function removeUser(u, after) {
  const c = u.templates || { total: 0 };
  const body = h(
    'div',
    { class: 'app-form app-form-dialog' },
    h('p', {}, `${u.username} will no longer be able to log in.`),
    c.total
      ? h(
          'div',
          { class: 'app-warn' },
          `They own ${countText(c)}. Shared templates stay available to others. `,
          'Personal templates are kept but only admins can see them. You can download them all now, or later from this Users window.',
        )
      : h('p', { class: 'app-dialog-intro' }, 'They have no templates.'),
    c.total
      ? h('button', { type: 'button', class: 'app-btn app-btn-sm app-btn-inline', onclick: () => downloadUrl(api.templateArchiveUrl(u.username)) }, `Download ${u.username}’s templates (.zip)`)
      : null,
  );
  openDialog({
    title: `Remove ${u.username}?`,
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Remove user',
        kind: 'danger',
        onClick: async () => {
          try {
            await api.deleteUser(u.id);
            toast(`${u.username} removed.`);
            after();
          } catch (err) {
            toast(err.message, { error: true });
            return false;
          }
          return true;
        },
      },
    ],
  });
}

async function manageUsers() {
  const body = h('div');
  const draw = async () => {
    let users;
    let removedOwners;
    let allGroups;
    try {
      ({ users, removedOwners = [] } = await api.listUsers());
      ({ groups: allGroups } = await api.listGroups());
    } catch (err) {
      body.replaceChildren(h('p', {}, err.message));
      return;
    }
    const rows = users.map((u) => {
      const role = h('select', { 'aria-label': `Role for ${u.username}` }, h('option', { value: 'editor' }, 'Editor'), h('option', { value: 'admin' }, 'Admin'));
      role.value = u.role;
      role.addEventListener('change', async () => {
        try {
          await api.updateUser(u.id, { role: role.value });
          toast(`${u.username} is now ${role.value === 'admin' ? 'an admin' : 'an editor'}.`);
        } catch (err) {
          role.value = u.role;
          toast(err.message, { error: true });
        }
      });
      const groupsBtn = h(
        'button',
        { type: 'button', class: 'app-link-btn', title: 'Change groups', onclick: () => editUserGroups(u, allGroups, draw) },
        u.groups.length ? u.groups.map((g) => g.name).join(', ') : 'None',
      );
      const actions = h(
        'td',
        { class: 'app-actions' },
        u.lockedUntil
          ? h('button', { type: 'button', class: 'app-btn app-btn-sm', onclick: async () => { await api.updateUser(u.id, { unlock: true }); toast(`${u.username} unlocked.`); draw(); } }, 'Unlock')
          : null,
        ' ',
        h('button', { type: 'button', class: 'app-btn app-btn-sm', onclick: () => resetPassword(u) }, 'Reset password'),
        ' ',
        u.id === session.user.id
          ? null
          : h('button', {
              type: 'button',
              class: 'app-icon-btn',
              title: `Remove ${u.username}`,
              'aria-label': `Remove ${u.username}`,
              html: ICONS.trash,
              onclick: () => removeUser(u, draw),
            }),
      );
      return h(
        'tr',
        {},
        h('td', {}, h('strong', {}, u.username), u.lockedUntil ? [' ', h('span', { class: 'app-badge app-badge-warn' }, `Locked until ${formatDate(u.lockedUntil)}`)] : null),
        h('td', {}, role),
        h('td', {}, groupsBtn),
        h('td', { class: 'app-muted' }, String(u.templates?.total || 0)),
        h('td', { class: 'app-muted' }, formatDate(u.lastLoginAt)),
        actions,
      );
    });

    const form = h('form', { class: 'app-inline-form', novalidate: true });
    const name = h('input', { class: 'app-input', id: 'nu-name', autocomplete: 'off', spellcheck: 'false' });
    const pw = h('input', { class: 'app-input', id: 'nu-pw', type: 'password', autocomplete: 'new-password' });
    const role = h('select', { id: 'nu-role' }, h('option', { value: 'editor' }, 'Editor'), h('option', { value: 'admin' }, 'Admin'));
    form.append(
      h('div', { class: 'app-field' }, h('label', { for: 'nu-name' }, 'Username'), name),
      h('div', { class: 'app-field' }, h('label', { for: 'nu-pw' }, 'Temporary password'), pw),
      h('div', { class: 'app-field' }, h('label', { for: 'nu-role' }, 'Role'), role),
      h('button', { type: 'submit', class: 'app-btn app-btn-primary' }, 'Add user'),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.createUser({ username: name.value.trim(), password: pw.value, role: role.value });
        toast(`Added ${name.value.trim()}. Give them their password securely and ask them to change it.`, { ms: 5000 });
        draw();
      } catch (err) {
        toast(err.message, { error: true, ms: 5000 });
      }
    });

    // Groups
    const groupRows = allGroups.map((g) => {
      const input = h('input', { class: 'app-input app-input-sm', value: g.name, 'aria-label': `Name of ${g.name}` });
      input.addEventListener('change', async () => {
        try {
          await api.renameGroup(g.id, input.value);
          toast(`Renamed to ${input.value.trim()}.`);
          draw();
        } catch (err) {
          input.value = g.name;
          toast(err.message, { error: true });
        }
      });
      return h(
        'tr',
        {},
        h('td', {}, input),
        h('td', { class: 'app-muted' }, `${g.members} member${g.members === 1 ? '' : 's'}`),
        h('td', { class: 'app-muted' }, `${g.templates} template${g.templates === 1 ? '' : 's'}`),
        h(
          'td',
          { class: 'app-actions' },
          h('button', {
            type: 'button',
            class: 'app-icon-btn',
            title: `Delete ${g.name}`,
            'aria-label': `Delete ${g.name}`,
            html: ICONS.trash,
            onclick: async () => {
              const note = g.templates ? `\n\nIts ${g.templates} template${g.templates === 1 ? '' : 's'} will become personal templates of their owners.` : '';
              if (!confirm(`Delete the group “${g.name}”?${note}`)) return;
              try {
                await api.deleteGroup(g.id);
                toast(`Deleted ${g.name}.`);
                draw();
              } catch (err) {
                toast(err.message, { error: true });
              }
            },
          }),
        ),
      );
    });
    const groupForm = h('form', { class: 'app-inline-form app-inline-form-2', novalidate: true });
    const groupName = h('input', { class: 'app-input', id: 'ng-name', autocomplete: 'off', placeholder: 'e.g. Junior School' });
    groupForm.append(h('div', { class: 'app-field' }, h('label', { for: 'ng-name' }, 'New group'), groupName), h('button', { type: 'submit', class: 'app-btn' }, 'Add group'));
    groupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.createGroup(groupName.value);
        toast(`Added group ${groupName.value.trim()}.`);
        draw();
      } catch (err) {
        toast(err.message, { error: true });
      }
    });

    const parts = [
      h(
        'table',
        { class: 'app-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'User'), h('th', {}, 'Role'), h('th', {}, 'Groups'), h('th', {}, 'Templates'), h('th', {}, 'Last login'), h('th', {}))),
        h('tbody', {}, rows),
      ),
      h('h3', { class: 'app-subhead' }, 'Add a user'),
      form,
      h('p', { class: 'app-dialog-intro' }, `${PASSWORD_HELP} Admins can manage users; editors can do everything else.`),
      h('h3', { class: 'app-subhead' }, 'Groups'),
      allGroups.length ? h('table', { class: 'app-table' }, h('tbody', {}, groupRows)) : h('p', { class: 'app-dialog-intro' }, 'No groups yet. Groups let staff share templates with each other.'),
      groupForm,
      removedOwners.length
        ? [
            h('h3', { class: 'app-subhead' }, 'Templates of removed users'),
            h(
              'table',
              { class: 'app-table' },
              h(
                'tbody',
                {},
                removedOwners.map((o) =>
                  h(
                    'tr',
                    {},
                    h('td', {}, h('strong', {}, o.username)),
                    h('td', { class: 'app-muted' }, `${o.templates} template${o.templates === 1 ? '' : 's'}`),
                    h('td', { class: 'app-actions' }, h('button', { type: 'button', class: 'app-btn app-btn-sm', onclick: () => downloadUrl(api.templateArchiveUrl(o.username)) }, 'Download .zip')),
                  ),
                ),
              ),
            ),
          ]
        : [],
    ];
    // replaceChildren() doesn't flatten arrays or skip nulls, so do that here.
    body.replaceChildren(...parts.flat().filter(Boolean));
  };
  await draw();
  openDialog({ title: 'Users', body, wide: true });
}

async function resetPassword(u) {
  const values = await promptDialog({
    title: `Reset password for ${u.username}`,
    submitLabel: 'Set password',
    intro: 'They will be signed out everywhere and any lockout is cleared.',
    fields: [{ name: 'password', label: 'New password', type: 'password', autocomplete: 'new-password', help: PASSWORD_HELP }],
    validate: async (v) => {
      try {
        await api.updateUser(u.id, { password: v.password });
      } catch (err) {
        return err.message;
      }
      return null;
    },
  });
  if (values) toast(`Password reset for ${u.username}.`);
}
