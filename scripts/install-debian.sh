#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/install-debian.sh" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-/opt/shadowgrid}"
APP_USER="${APP_USER:-shadowgrid}"
APP_GROUP="${APP_GROUP:-shadowgrid}"
PORT="${PORT:-5173}"
NODE_MAJOR="${NODE_MAJOR:-18}"

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg rsync gettext-base
apt-get install -y ffmpeg

install -d -m 0755 "$APP_DIR"
if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete --exclude node_modules --exclude .git "$SOURCE_DIR/" "$APP_DIR/"
fi

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/^v//' | cut -d. -f1)" -lt "$NODE_MAJOR" ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi

if ! getent group "$APP_GROUP" >/dev/null; then
  groupadd --system "$APP_GROUP"
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --gid "$APP_GROUP" --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

if [[ ! -f "$APP_DIR/.env" && -f "$APP_DIR/.env.example" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi



# Install dependencies as service user and fail if it doesn't succeed

echo "[install-debian.sh] Installing npm dependencies as $APP_USER in $APP_DIR..."
if ! runuser -u "$APP_USER" -- bash -lc "cd '$APP_DIR' && npm install"; then
  echo "[install-debian.sh] ERROR: npm install failed. Aborting install." >&2
  exit 2
fi

# Check for vite.js (critical dependency)
if [[ ! -f "$APP_DIR/node_modules/vite/bin/vite.js" ]]; then
  echo "[install-debian.sh] ERROR: vite.js not found after npm install. Check npm logs and try again." >&2
  exit 3
fi

# Prompt for camera database mode and generate camera database/tiles
echo "[install-debian.sh] Generating camera database and tiles for CCTV layer..."
CAMERA_MODE="both"
if [ -t 0 ]; then
  echo "Select camera database mode:"
  select opt in "osm (OpenStreetMap, default)" "trafficvision (legacy feed mode)" "both (deduplicated)"; do
    case $REPLY in
      1) CAMERA_MODE="osm"; break;;
      2) CAMERA_MODE="trafficvision"; break;;
      3) CAMERA_MODE="both"; break;;
      *) echo "Invalid option";;
    esac
  done
else
  echo "No TTY detected, defaulting to mode: both"
fi
echo "[install-debian.sh] Running: node server/collectors/collectCameras.mjs --mode=$CAMERA_MODE"
if ! runuser -u "$APP_USER" -- bash -lc "cd '$APP_DIR' && node server/collectors/collectCameras.mjs --mode=$CAMERA_MODE"; then
  echo "[install-debian.sh] ERROR: Camera database generation failed. You may need to run it manually." >&2
fi

cat > /etc/systemd/system/shadowgrid.service <<EOF
[Unit]
Description=ShadowGrid Geospatial Intelligence Platform
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run dev -- --host --server
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

# Enable and start the service only if dependencies are present
systemctl enable --now shadowgrid.service

echo
echo "[install-debian.sh] Install complete. Service: systemctl status shadowgrid.service"
echo "[install-debian.sh] If the service fails to start, check /opt/shadowgrid/node_modules and rerun npm install as the shadowgrid user."
