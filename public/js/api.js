async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const api = {
  config: () => fetch('/api/config').then(json),

  exportHtml: (doc) =>
    fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc }),
    }).then(json),

  listUploads: (project) =>
    fetch('/api/uploads' + (project ? `?project=${encodeURIComponent(project)}` : '')).then(json),

  upload(files, project) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    return fetch(`/api/uploads?project=${encodeURIComponent(project)}`, { method: 'POST', body: fd }).then(json);
  },

  deleteUpload: (path) => fetch(`/api/uploads?path=${encodeURIComponent(path)}`, { method: 'DELETE' }).then(json),
};
