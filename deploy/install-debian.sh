#!/usr/bin/env bash
# Swiftwing: install or update on a Debian 12/13 host or LXC.
# Run as root. Safe to re-run: on an existing install it pulls the latest code,
# reinstalls packages and restarts the service, keeping settings and uploads.
#
#   bash install-debian.sh
#   PUBLIC_BASE_URL=https://email.example.org CADDY_IP=10.50.0.10 bash install-debian.sh
#
# Layout:
#   /opt/atelier-email-builder             app code (git checkout, owned by root)
#   /etc/atelier-email-builder/env         settings (EnvironmentFile for systemd)
#   /var/lib/atelier-email-builder/uploads uploaded images
#   /var/lib/atelier-email-builder/atelier.db  accounts, sessions, templates (SQLite)
#   atelier-email-builder.service          runs as the "atelier" system user
#   /usr/local/bin/atelier-user            account management (run as root)
#
# Optional variables:
#   PUBLIC_BASE_URL  public HTTPS address of the site (written to the settings file)
#   CADDY_IP         if set, only this IP (and localhost) may connect to the app port
#   PORT             app port for a new install (default 3000)
#   REPO_URL         git URL (default: GitHub repo)
#   BRANCH           git branch for a new install (default: main)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/skittle-brau/atelier-email-builder.git}"
BRANCH="${BRANCH:-main}"
SERVICE=atelier-email-builder
APP_USER=atelier
APP_DIR=/opt/atelier-email-builder
CONF_DIR=/etc/atelier-email-builder
ENV_FILE="$CONF_DIR/env"
STATE_DIR=/var/lib/atelier-email-builder
DATA_DIR="$STATE_DIR/uploads"

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

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
mkdir -p "$DATA_DIR" "$CONF_DIR"
chown -R "$APP_USER:$APP_USER" "$STATE_DIR"

echo "==> App code"
if [ -d "$APP_DIR/.git" ]; then
  # --ff-only refuses to overwrite local edits on the server instead of discarding them.
  git -C "$APP_DIR" pull --ff-only
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
git -C "$APP_DIR" log --oneline -1
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

echo "==> Account tool (/usr/local/bin/atelier-user)"
cat > /usr/local/bin/atelier-user <<EOF
#!/bin/sh
# Manage Swiftwing accounts:
#   atelier-user add <username> [--admin] | passwd <username> | role <username> admin|editor
#   atelier-user unlock <username> | remove <username> | list
set -a; . $ENV_FILE; set +a
exec runuser -u $APP_USER -- /usr/bin/node $APP_DIR/server/cli.js user "\$@"
EOF
chmod 0755 /usr/local/bin/atelier-user

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
    if ! atelier-user list 2>/dev/null | grep -qv '^No accounts'; then
      echo "NEXT: create the first admin account with: atelier-user add <your-username> --admin"
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
