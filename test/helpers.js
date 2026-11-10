import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

/**
 * Start the app on a random port with a temp upload folder and in-memory DB.
 * Returns helpers that send the session cookie and a same-site Origin header.
 */
export async function startApp(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'atelier-test-'));
  const app = createApp({ uploadDir: dir, publicBaseUrl: 'https://mail.example.org', ...options });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = app.locals.auth;

  function client(cookie = '') {
    const c = {
      cookie,
      async fetch(p, init = {}) {
        const headers = new Headers(init.headers || {});
        if (c.cookie) headers.set('cookie', c.cookie);
        if (!headers.has('origin') && init.method && init.method !== 'GET') headers.set('origin', base);
        if (init.json !== undefined) {
          headers.set('content-type', 'application/json');
          init = { ...init, body: JSON.stringify(init.json) };
        }
        const res = await fetch(base + p, { redirect: 'manual', ...init, headers });
        const set = res.headers.get('set-cookie');
        if (set) c.cookie = set.split(';')[0];
        return res;
      },
      async login(username, password) {
        return c.fetch('/api/auth/login', { method: 'POST', json: { username, password } });
      },
    };
    return c;
  }

  async function userClient(username, role = 'editor', password = 'correct horse battery') {
    if (!auth.findUser(username)) await auth.createUser(username, password, role);
    const c = client();
    const res = await c.login(username, password);
    if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
    return c;
  }

  return {
    app, base, dir, auth, client, userClient,
    close() {
      server.close();
      app.locals.db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
