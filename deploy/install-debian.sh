#!/usr/bin/env bash
# Atelier Email Builder — install/update on a bare Debian 12/13 host or LXC.
# Run as root. Safe to re-run: it updates the code and restarts the service.
#
#   PUBLIC_BASE_URL=https://email.example.org CADDY_IP=192.168.1.40 bash install-debian.sh
#
# Variables:
#   PUBLIC_BASE_URL  public HTTPS address of the site (required on first install)
#   CADDY_IP         if set, only this IP (and localhost) may connect to the app port
#   PORT             app port (default 3000)
#   REPO_URL         git URL (default: GitHub repo)
#   BRANCH           git branch (default: main)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/skittle-brau/atelier-email-builder.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"
APP_DIR=/opt/atelier/app
DATA_DIR=/var/lib/atelier/uploads
ENV_FILE="$APP_DIR/.env"

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
as_app() { su -s /bin/sh atelier -c "$*"; }

echo "==> Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl ca-certificates git

echo "==> Installing Node.js 22"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=9)?0:1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
node -v

echo "==> Creating app user and folders"
id atelier >/dev/null 2>&1 || adduser --system --group --home /opt/atelier atelier
mkdir -p "$DATA_DIR"
chown -R atelier:atelier /opt/atelier /var/lib/atelier

echo "==> Fetching code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  as_app "cd $APP_DIR && git fetch -q origin $BRANCH && git checkout -q $BRANCH && git reset -q --hard origin/$BRANCH"
else
  as_app "git clone -q --branch $BRANCH $REPO_URL $APP_DIR"
fi
as_app "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund"

echo "==> Writing configuration"
if [ ! -f "$ENV_FILE" ]; then
  : "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL=https://your-domain on first install}"
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
HOST=0.0.0.0
UPLOAD_DIR=$DATA_DIR
PUBLIC_BASE_URL=$PUBLIC_BASE_URL
EOF
  chown atelier:atelier "$ENV_FILE"
elif [ -n "${PUBLIC_BASE_URL:-}" ]; then
  sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=$PUBLIC_BASE_URL#" "$ENV_FILE"
fi

echo "==> Installing systemd service"
cat > /etc/systemd/system/atelier.service <<EOF
[Unit]
Description=Atelier Email Builder
After=network.target

[Service]
User=atelier
Group=atelier
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --env-file-if-exists=.env server/index.js
Restart=on-failure
Environment=NODE_ENV=production
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q atelier
systemctl restart atelier

if [ -n "${CADDY_IP:-}" ]; then
  echo "==> Restricting port $PORT to $CADDY_IP"
  apt-get install -y -q nftables
  cat > /etc/nftables.conf <<EOF
#!/usr/sbin/nft -f
flush ruleset
table inet filter {
  chain input {
    type filter hook input priority 0; policy accept;
    tcp dport $PORT ip saddr != { 127.0.0.1, $CADDY_IP } drop
  }
}
EOF
  systemctl enable -q nftables
  systemctl restart nftables
fi

echo "==> Checking health"
for i in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "OK: Atelier is running on port $PORT"
    grep '^PUBLIC_BASE_URL=' "$ENV_FILE"
    exit 0
  fi
  sleep 1
done
echo "Service did not become healthy. Logs:" >&2
journalctl -u atelier -n 40 --no-pager >&2
exit 1
