# CLAUDE.md

Context for Claude sessions working on this repository. README.md has the
user-facing documentation; this file records how the project is run, decisions
already made, and what is still open.

**This repository is public.** Don't add hostnames, IP addresses, usernames,
credentials or other details of the school's infrastructure here, in commits or
in PR descriptions. Ask the user for the production server's address when it's
needed, and write commands for it with a placeholder (`root@<server>`).

## What this is

**Swiftwing** (formerly "Atelier Email Builder"): a drag-and-drop HTML email
editor for a school. Staff build emails in the browser, export HTML, and load it
into **Synergetic** (the school's CRM) to send. Single-server Node app.

- Node ≥ 22.13 (uses built-in `node:sqlite`), Express 5, no front-end build step
  (browser loads ES modules; TinyMCE 8 and SortableJS served from `node_modules`).
- `shared/` runs in both browser and Node: `blocks.js` (block catalogue, inspector
  field schemas, document model), `render.js` (table-based renderer + CSS),
  `paths.js` (upload folder naming). The canvas and the export use the same
  renderer.
- Export pipeline (`server/lib/exporter.js`): render → `juice` CSS inlining →
  `serialize()` for the chosen doctype → lint warnings. Output is always 7-bit
  ASCII (all non-ASCII as numeric references); see Synergetic findings below.
- Storage: SQLite (`server/lib/db.js`, versioned migrations via
  `PRAGMA user_version`) for users, sessions, login throttling, groups and
  templates; images are plain files under `UPLOAD_DIR/YYYY/MM/<Project>/`
  (resized to ≤1200 px by `sharp` on upload).

## Commands

```bash
npm test                         # node:test suites in test/ (all must pass before pushing)
npm start                        # http://localhost:3000 (reads .env if present)
npm run user -- add NAME --admin # create an account (dev); on the server: swiftwing-user
node server/cli.js backup        # snapshot the database (VACUUM INTO), keep newest 14
npm run synergetic-tests         # regenerate docs/synergetic-tests/10–12 full exports
npm run synergetic-compare -- docs/synergetic-tests   # diff *.html vs *.after*.html
```

Browser testing: Playwright + Chromium are preinstalled in cloud sessions
(`require('playwright')`). The usual pattern: create users with the CLI against a
temp `UPLOAD_DIR`, start `node server/index.js` on another port, log in, drive the
UI and take screenshots. Test-only Node fetches to YouTube/Vimeo need
`NODE_USE_ENV_PROXY=1` in the cloud sandbox (not on the real server).

## Working conventions

- Develop on the branch the session is told to use (so far
  `claude/friendly-goldberg-14k0ot`); separate features go on separate branches
  only when the user asks (e.g. `claude/table-block`). After a PR merges, restart
  the branch from `origin/main` for the next piece of work.
- Open PRs only when the user asks. The user merges them; then they update the
  server (below).
- The GitHub repo was renamed to **Swiftwing**, but this session's Git access is
  scoped to the old name: keep the `origin` URL as
  `https://github.com/skittle-brau/atelier-email-builder` (GitHub redirects).
  Pushing to the new URL is refused with 403.
- Commit messages end with the Co-Authored-By / Claude-Session lines given in the
  session; no model names in commits, PRs or code.
- Explain Git steps (merge order, what a branch or PR step does) briefly and in
  plain terms.

## Production deployment

- A Debian 13 container on the school's internal network, app on port 3000.
  The user manages the reverse proxy (Caddy, on a separate host); the app's own
  login replaced proxy basic auth. The server is not reachable from cloud
  sessions, so the user runs server commands themselves.
- Installed and updated by `deploy/install-debian.sh` (run as root; safe to
  re-run; restarts itself if an update changes the script):

  ```bash
  ssh root@<server> 'bash /opt/swiftwing/deploy/install-debian.sh'
  ```

| Path | Purpose |
|---|---|
| `/opt/swiftwing` | git checkout (owned by root) |
| `/etc/swiftwing/env` | settings: `PORT`, `HOST`, `UPLOAD_DIR`, `PUBLIC_BASE_URL`, `MAX_IMAGE_WIDTH`, `JPEG_QUALITY`, `TRUST_PROXY` … |
| `/var/lib/swiftwing/swiftwing.db` | SQLite database |
| `/var/lib/swiftwing/uploads/` | images (`YYYY/MM/Project/`) |
| `/var/lib/swiftwing/backups/` | nightly DB backups |
| `swiftwing.service` | the app, runs as user `swiftwing` |
| `swiftwing-backup.timer` | daily 04:00 Australia/Perth (AWST), keeps 14 |
| `/usr/local/bin/swiftwing-user` | account CLI (add / passwd / role / unlock / remove / list) |

The script migrates installs that predate the rename (`/opt/atelier-email-builder`,
`atelier-email-builder.service`, user `atelier`). `defaultDbPath()` still falls
back to an existing `atelier.db`.

## Decisions already made (don't relitigate without the user)

- **SQLite stays**, including for the future container deployment (one
  instance, data volume on local disk, back up before auto-updates). Postgres
  only if multiple instances or an IT-managed central DB become requirements.
- **Default export doctype: HTML 4.01 Transitional**; XHTML 1.0 Transitional and
  HTML5 are options (Email settings → Export). "Strict validation" omits
  `role="presentation"` (kept in HTML5) and VML namespaces.
- **Accounts**: scrypt, 12+ char passwords, 5 failures → 15-minute lockout per
  username, per-IP throttle, server-side sessions (HttpOnly cookie
  `swiftwing_session`), Origin check on writes. Roles: admin / editor.
- **Templates**: personal (default), group, or everyone; owners or admins edit
  and re-share; names unique per owner; removed users' templates kept for admins
  and downloadable as .zip. Groups are admin-managed (web UI only, not the CLI).
- **Media**: "All projects" is a year → month (numeric, e.g. `11`) → project
  tree; only admins can purge project / month / year folders (typed confirmation
  for month and year). Uploads are expected to be kept about two years; old
  months are labelled, never auto-deleted (auto-purge was offered, not built).
- **Images keep pixel widths** even in the full-width (100%) layout, because
  Outlook ignores percentage image widths.

## Synergetic findings (export target)

- Staff load emails via **Notifications Layout tab → Load HTML** (file upload of
  Swiftwing's Download .html).
- Load HTML reads files as Windows-1252: raw UTF-8 characters are garbled, numeric
  references survive. **Keep all export output 7-bit ASCII.**
- Swiftwing exports (`docs/synergetic-tests/10–12`) came back byte-identical.
- File 01 came back rewritten by **MSHTML 11 (IE engine)**: doctype dropped,
  `<!--[if mso]>` conditional comments removed, upper-case tags, unquoted
  attributes, `padding` expanded to longhands, `0` → `0px`, `<tbody>` added. Most
  other test files were unchanged, so the rewrite seems to happen only when
  Synergetic's visual editor re-renders the content (unconfirmed).
- **Open: round 2.** Load `10-swiftwing-export-html4.html` and
  `07-comments-and-outlook.html`, make a small edit in the visual view, save,
  reopen, copy the code view into `*.after2.html`; send a test email to Outlook
  desktop and a phone. If the content is rewritten, stage 2 adds rules to
  `SYNERGETIC_RULES` in `server/lib/exporter.js` (applied when "Synergetic
  compatibility" is ticked), most likely: stop relying on Outlook conditional
  comments and keep everything inline.

## Open items

1. PR #12 (install script re-runs itself + this file): after merge, run the
   install script once more; that run also creates the backup timer from #11
   (verify with `systemctl list-timers swiftwing-backup`).
2. Synergetic round 2 (above), then stage 2 rules.
3. Later, when the user says production is ready: Podman deployment: GitHub
   Actions builds an image to GHCR (user to choose: on release tags → `:stable`,
   or every merge → `:latest`; public or private image), Quadlet
   `.container` with `AutoUpdate=registry`, `HEALTHCHECK` + `Notify=healthy` for
   rollback, fully-qualified base image in the Dockerfile, host-side nightly and
   pre-update `podman exec … backup`.
