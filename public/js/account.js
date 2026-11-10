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

async function manageUsers() {
  const body = h('div');
  const draw = async () => {
    let users;
    try {
      ({ users } = await api.listUsers());
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
      const actions = h(
        'td',
        { class: 'app-actions' },
        u.lockedUntil
          ? h('button', { type: 'button', class: 'app-btn app-btn-sm', onclick: async () => { await api.updateUser(u.id, { unlock: true }); toast(`${u.username} unlocked.`); draw(); } }, 'Unlock')
          : null,
        ' ',
        h('button', { type: 'button', class: 'app-btn app-btn-sm', onclick: () => resetPassword(u) }, 'Reset password'),
        ' ',
        h('button', {
          type: 'button',
          class: 'app-icon-btn',
          title: `Remove ${u.username}`,
          'aria-label': `Remove ${u.username}`,
          html: ICONS.trash,
          onclick: async () => {
            if (!confirm(`Remove the account "${u.username}"? Templates they created are kept.`)) return;
            try {
              await api.deleteUser(u.id);
              toast(`${u.username} removed.`);
              draw();
            } catch (err) {
              toast(err.message, { error: true });
            }
          },
        }),
      );
      return h(
        'tr',
        {},
        h('td', {}, h('strong', {}, u.username), u.lockedUntil ? [' ', h('span', { class: 'app-badge app-badge-warn' }, `Locked until ${formatDate(u.lockedUntil)}`)] : null),
        h('td', {}, role),
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

    body.replaceChildren(
      h('table', { class: 'app-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'User'), h('th', {}, 'Role'), h('th', {}, 'Last login'), h('th', {}))), h('tbody', {}, rows)),
      h('h3', { class: 'app-subhead' }, 'Add a user'),
      form,
      h('p', { class: 'app-dialog-intro' }, `${PASSWORD_HELP} Admins can manage users; editors can do everything else.`),
    );
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
