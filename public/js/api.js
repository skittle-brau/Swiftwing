async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && body.loginRequired) {
    // Session expired or signed out elsewhere: the design is autosaved locally.
    location.href = '/login';
    throw new Error('Your session has ended. Please log in again.');
  }
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

const send = (method, url, data) =>
  fetch(url, {
    method,
    headers: data !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: data !== undefined ? JSON.stringify(data) : undefined,
  }).then(json);

export const api = {
  config: () => fetch('/api/config').then(json),

  exportHtml: (doc) => send('POST', '/api/export', { doc }),

  listUploads: (project) =>
    fetch('/api/uploads' + (project ? `?project=${encodeURIComponent(project)}` : '')).then(json),

  upload(files, project) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    return fetch(`/api/uploads?project=${encodeURIComponent(project)}`, { method: 'POST', body: fd }).then(json);
  },

  deleteUpload: (path) => send('DELETE', `/api/uploads?path=${encodeURIComponent(path)}`),

  // Account
  me: () => fetch('/api/auth/me').then(json),
  logout: () => send('POST', '/api/auth/logout', {}),
  changePassword: (currentPassword, newPassword) => send('POST', '/api/auth/password', { currentPassword, newPassword }),

  // User admin
  listUsers: () => fetch('/api/users').then(json),
  createUser: (data) => send('POST', '/api/users', data),
  updateUser: (id, data) => send('PATCH', `/api/users/${id}`, data),
  deleteUser: (id) => send('DELETE', `/api/users/${id}`),

  // Templates
  listTemplates: () => fetch('/api/templates').then(json),
  getTemplate: (id) => fetch(`/api/templates/${id}`).then(json),
  createTemplate: (data) => send('POST', '/api/templates', data),
  updateTemplate: (id, data) => send('PUT', `/api/templates/${id}`, data),
  deleteTemplate: (id) => send('DELETE', `/api/templates/${id}`),

  // Video thumbnails
  videoThumbnail: (url, project, style) => send('POST', '/api/video', { url, project, style }),
};
