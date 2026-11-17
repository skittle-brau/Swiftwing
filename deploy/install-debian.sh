#!/usr/bin/env bash
# Swiftwing: install or update on a Debian 12/13 host or LXC.
# Run as root. Safe to re-run: on an existing install it pulls the latest code,
# reinstalls packages and restarts the service, keeping settings and uploads.
#
#   bash install-debian.sh
#   PUBLIC_BASE_URL=https://email.example.org CADDY_IP=192.0.2.10 bash install-debian.sh
#
# Layout:
#   /opt/swiftwing                     app code (git checkout, owned by root)
#   /etc/swiftwing/env                 settings (EnvironmentFile for systemd)
#   /var/lib/swiftwing/uploads         uploaded images
#   /var/lib/swiftwing/swiftwing.db    accounts, sessions, templates (SQLite)
#   swiftwing.service                  runs as the "swiftwing" system user
#   /usr/local/bin/swiftwing-user      account management (run as root)
#   /var/lib/swiftwing/backups/        nightly database backups (04:00 Perth time, last 14 kept)
#   swiftwing-backup.timer             runs swiftwing-backup.service each night
#
# An install from before the rename (/opt/atelier-email-builder,
# atelier-email-builder.service, user "atelier") is moved to this layout
# automatically, keeping its settings, uploads and database.
#
# Optional variables:
#   PUBLIC_BASE_URL  public HTTPS address of the site (written to the settings file)
#   CADDY_IP         if set, only this IP (and localhost) may connect to the app port
#   PORT             app port for a new install (default 3000)
#   REPO_URL         git URL (default: GitHub repo)
#   BRANCH           git branch for a new install (default: main)
#   BACKUP_TIME      daily backup time, systemd calendar format (default: 04:00:00 Australia/Perth)
#   BACKUP_KEEP      number of nightly backups to keep (default: 14)
set -euo pipefail

# Fingerprint of this script as it was when it started. The "App code" step may
# pull a newer version of it; if so, the newer one is run instead (see below).
SELF="${BASH_SOURCE[0]:-}"
SELF_SUM=""
if [ -n "$SELF" ] && [ -f "$SELF" ]; then SELF_SUM="$(sha256sum "$SELF" | cut -d' ' -f1)"; fi

REPO_URL="${REPO_URL:-https://github.com/skittle-brau/atelier-email-builder.git}"
BRANCH="${BRANCH:-main}"
SERVICE=swiftwing
APP_USER=swiftwing
APP_DIR=/opt/swiftwing
CONF_DIR=/etc/swiftwing
ENV_FILE="$CONF_DIR/env"
STATE_DIR=/var/lib/swiftwing
DATA_DIR="$STATE_DIR/uploads"
BACKUP_DIR="$STATE_DIR/backups"
BACKUP_TIME="${BACKUP_TIME:-04:00:00 Australia/Perth}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
USER_TOOL=/usr/local/bin/swiftwing-user

# Names used before the app was renamed from Atelier Email Builder.
OLD_SERVICE=atelier-email-builder
OLD_USER=atelier
OLD_APP_DIR=/opt/atelier-email-builder
OLD_CONF_DIR=/etc/atelier-email-builder
OLD_STATE_DIR=/var/lib/atelier-email-builder

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# Move a path to its new name, unless the new one already exists.
move() {
  if [ -e "$1" ] && [ ! -e "$2" ]; then
    echo "    $1 -> $2"
    mv "$1" "$2"
  fi
}

if [ -e "/etc/systemd/system/$OLD_SERVICE.service" ] || [ -d "$OLD_APP_DIR" ] || [ -d "$OLD_STATE_DIR" ]; then
  echo "==> Moving the Atelier install to the Swiftwing layout"
  if [ -e "/etc/systemd/system/$OLD_SERVICE.service" ]; then
    systemctl disable --now "$OLD_SERVICE" 2>/dev/null || true
    rm -f "/etc/systemd/system/$OLD_SERVICE.service"
    systemctl daemon-reload
  fi
  move "$OLD_APP_DIR" "$APP_DIR"
  move "$OLD_CONF_DIR" "$CONF_DIR"
  move "$OLD_STATE_DIR" "$STATE_DIR"
  for ext in "" -wal -shm; do
    [ -e "$STATE_DIR/swiftwing.db" ] || move "$STATE_DIR/atelier.db$ext" "$STATE_DIR/swiftwing.db$ext"
  done
  [ -f "$ENV_FILE" ] && sed -i "s#$OLD_STATE_DIR#$STATE_DIR#g" "$ENV_FILE"
  rm -f /usr/local/bin/atelier-user
  if id "$OLD_USER" >/dev/null 2>&1 && ! id "$APP_USER" >/dev/null 2>&1; then
    usermod -l "$APP_USER" -d "$STATE_DIR" "$OLD_USER"
    groupmod -n "$APP_USER" "$OLD_USER" 2>/dev/null || true
  fi
fi

echo "==> Installing base packages"
apt-get update -q
apt-get install -y -q curl ca-certificates git

echo "==> Checking Node.js (22.13 or newer)"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -v

echo "==> Service user and folders"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR" "$CONF_DIR" "$BACKUP_DIR"
chown -R "$APP_USER:$APP_USER" "$STATE_DIR"

echo "==> App code"
if [ -d "$APP_DIR/.git" ]; then
  # --ff-only refuses to overwrite local edits on the server instead of discarding them.
  git -C "$APP_DIR" pull --ff-only
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
git -C "$APP_DIR" log --oneline -1

# If that pull changed this install script, restart with the new version so its
# new steps run now rather than on the next update. SWIFTWING_REEXEC stops it
# looping; earlier steps are safe to repeat.
NEW_SCRIPT="$APP_DIR/deploy/install-debian.sh"
if [ -z "${SWIFTWING_REEXEC:-}" ] && [ -f "$NEW_SCRIPT" ] && [ "$(sha256sum "$NEW_SCRIPT" | cut -d' ' -f1)" != "$SELF_SUM" ]; then
  echo "==> The install script was updated; continuing with the new version"
  export SWIFTWING_REEXEC=1
  exec bash "$NEW_SCRIPT" "$@"
fi

(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund)
chown -R root:root "$APP_DIR"

echo "==> Settings ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=${PORT:-3000}
HOST=0.0.0.0
UPLOAD_DIR=$DATA_DIR
# Public HTTPS address mail clients load images from, e.g. https://email.example.org
PUBLIC_BASE_URL=${PUBLIC_BASE_URL:-}
# Uploaded images wider than this are downscaled (px)
MAX_IMAGE_WIDTH=1200
# JPEG compression quality (1-100)
JPEG_QUALITY=82
EOF
elif [ -n "${PUBLIC_BASE_URL:-}" ]; then
  if grep -q '^PUBLIC_BASE_URL=' "$ENV_FILE"; then
    sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=$PUBLIC_BASE_URL#" "$ENV_FILE"
  else
    echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL" >> "$ENV_FILE"
  fi
fi
APP_PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | tail -1)"
APP_PORT="${APP_PORT:-3000}"

echo "==> systemd service ($SERVICE)"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Swiftwing email builder
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q "$SERVICE"
systemctl restart "$SERVICE"

echo "==> Nightly database backup ($BACKUP_TIME, keeping $BACKUP_KEEP)"
cat > "/etc/systemd/system/$SERVICE-backup.service" <<EOF
[Unit]
Description=Swiftwing database backup
After=$SERVICE.service

[Service]
Type=oneshot
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
# Name backup files in Perth time.
Environment=TZ=Australia/Perth
ExecStart=/usr/bin/node server/cli.js backup --keep=$BACKUP_KEEP --dir=$BACKUP_DIR
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$STATE_DIR
EOF
cat > "/etc/systemd/system/$SERVICE-backup.timer" <<EOF
[Unit]
Description=Nightly Swiftwing database backup

[Timer]
OnCalendar=*-*-* $BACKUP_TIME
# If the server was off at backup time, run the backup when it next starts.
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable -q --now "$SERVICE-backup.timer"

echo "==> Account tool ($USER_TOOL)"
cat > "$USER_TOOL" <<EOF
#!/bin/sh
# Manage Swiftwing accounts:
#   swiftwing-user add <username> [--admin] | passwd <username> | role <username> admin|editor
#   swiftwing-user unlock <username> | remove <username> | list
set -a; . $ENV_FILE; set +a
exec runuser -u $APP_USER -- /usr/bin/node $APP_DIR/server/cli.js user "\$@"
EOF
chmod 0755 "$USER_TOOL"

if [ -n "${CADDY_IP:-}" ]; then
  echo "==> Restricting port $APP_PORT to $CADDY_IP"
  apt-get install -y -q nftables
  cat > /etc/nftables.conf <<EOF
#!/usr/sbin/nft -f
flush ruleset
table inet filter {
  chain input {
    type filter hook input priority 0; policy accept;
    tcp dport $APP_PORT ip saddr != { 127.0.0.1, $CADDY_IP } drop
  }
}
EOF
  systemctl enable -q nftables
  systemctl restart nftables
fi

echo "==> Checking health"
for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
    echo "OK: Swiftwing is running on port $APP_PORT"
    echo "    Database backups: $BACKUP_DIR (daily at $BACKUP_TIME; run one now with: systemctl start $SERVICE-backup)"
    if ! "$USER_TOOL" list 2>/dev/null | grep -qv '^No accounts'; then
      echo "NEXT: create the first admin account with: swiftwing-user add <your-username> --admin"
    fi
    if ! grep -q '^PUBLIC_BASE_URL=.\+' "$ENV_FILE"; then
      echo "NOTE: PUBLIC_BASE_URL is empty in $ENV_FILE. Set it to your public https:// address and run: systemctl restart $SERVICE"
    fi
    exit 0
  fi
  sleep 1
done
echo "Service did not become healthy. Logs:" >&2
journalctl -u "$SERVICE" -n 40 --no-pager >&2
exit 1
