/**
 * HTTP layer for authentication: session cookie, login gate, cross-site
 * request protection, and the /api/auth and /api/users routes.
 */
import express from 'express';
import { AuthError } from './auth.js';

export const COOKIE = 'swiftwing_session';

/** Paths reachable without logging in. Everything else needs a session. */
const PUBLIC_API = new Set(['/api/health', '/api/auth/login', '/api/auth/status']);
const PUBLIC_PAGES = /^\/(login(\.html)?|css\/.*|js\/login\.js|favicon\.ico|uploads\/.*)$/;
const APP_PAGES = new Set(['/', '/index.html']);

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* ignore malformed cookie */
      }
    }
  }
  return out;
}

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (req.secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req, res) {
  res.append('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${req.secure ? '; Secure' : ''}`);
}

/**
 * Reject state-changing requests that come from another site. Browsers always
 * send Origin on cross-site POST/PUT/PATCH/DELETE, so it must match this site.
 */
export function sameOriginGuard(publicBaseUrl) {
  const allowed = new Set();
  if (publicBaseUrl) {
    try {
      allowed.add(new URL(publicBaseUrl).host);
    } catch {
      /* invalid PUBLIC_BASE_URL is reported elsewhere */
    }
  }
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const source = req.get('origin') || req.get('referer');
    let host = null;
    try {
      host = source ? new URL(source).host : null;
    } catch {
      host = null;
    }
    if (host && (host === req.get('host') || allowed.has(host))) return next();
    res.status(403).json({ error: 'Request blocked: it did not come from this site.' });
  };
}

/** Attach req.user / req.session when a valid session cookie is present. */
export function loadSession(auth) {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const s = token ? auth.getSession(token) : null;
    if (s) {
      req.user = s.user;
      req.sessionHash = s.sessionHash;
    }
    next();
  };
}

/** Redirect pages / 401 API calls when not logged in. */
export function requireLogin() {
  return (req, res, next) => {
    if (req.user) return next();
    if (PUBLIC_API.has(req.path) || PUBLIC_PAGES.test(req.path)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please log in.', loginRequired: true });
    if (APP_PAGES.has(req.path)) return res.redirect(302, '/login');
    // Other static assets (app JS/CSS, editor libraries) contain no data.
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ error: 'Only admins can do that.' });
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function sendAuthError(err, res, next) {
  if (!(err instanceof AuthError)) return next(err);
  if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
  res.status(err.status).json({ error: err.message, locked: !!err.locked });
}

export function authRouter(auth) {
  const r = express.Router();

  r.get('/auth/status', (req, res) => {
    res.json({ hasUsers: auth.hasUsers(), user: req.user || null });
  });

  r.get('/auth/me', (req, res) => res.json({ user: req.user }));

  r.post('/auth/login', async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      const { token, user } = await auth.login(username, password, { ip: req.ip, userAgent: req.get('user-agent') || '' });
      setSessionCookie(req, res, token, auth.sessionMaxSeconds);
      res.json({ user });
    } catch (err) {
      sendAuthError(err, res, next);
    }
  });

  r.post('/auth/logout', (req, res) => {
    auth.logout(parseCookies(req.headers.cookie)[COOKIE]);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  r.post('/auth/password', async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      await auth.changeOwnPassword(req.user.id, currentPassword, newPassword, req.sessionHash);
      res.json({ ok: true });
    } catch (err) {
      sendAuthError(err, res, next);
    }
  });

  /* ------------------------------------------------------ user admin */

  r.get('/users', requireAdmin, (_req, res) => res.json({ users: auth.listUsers() }));

  r.post('/users', requireAdmin, async (req, res, next) => {
    try {
      const { username, password, role } = req.body || {};
      const user = await auth.createUser(username, password, role || 'editor');
      res.status(201).json({ user });
    } catch (err) {
      sendAuthError(err, res, next);
    }
  });

  r.patch(
    '/users/:id',
    requireAdmin,
    asyncRoute(async (req, res, next) => {
      try {
        const id = Number(req.params.id);
        const { role, password, unlock } = req.body || {};
        const user = auth.getUser(id);
        if (!user) throw new AuthError('User not found.', 404);
        if (role) auth.setRole(id, role);
        if (password) await auth.setPassword(id, password, { keepSessionHash: id === req.user.id ? req.sessionHash : null });
        if (unlock) auth.unlock(user.username);
        res.json({ user: auth.getUser(id) });
      } catch (err) {
        sendAuthError(err, res, next);
      }
    }),
  );

  r.delete('/users/:id', requireAdmin, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (id === req.user.id) throw new AuthError('You cannot remove your own account.', 409);
      auth.deleteUser(id);
      res.json({ ok: true });
    } catch (err) {
      sendAuthError(err, res, next);
    }
  });

  return r;
}
