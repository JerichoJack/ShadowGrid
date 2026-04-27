#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/uninstall-debian.sh" >&2
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/shadowgrid}"
APP_USER="${APP_USER:-shadowgrid}"
APP_GROUP="${APP_GROUP:-shadowgrid}"

# Stop and disable the systemd service
if systemctl is-enabled --quiet shadowgrid.service 2>/dev/null; then
  systemctl disable --now shadowgrid.service || true
fi

# Remove the systemd service file
if [[ -f /etc/systemd/system/shadowgrid.service ]]; then
  rm -f /etc/systemd/system/shadowgrid.service
  systemctl daemon-reload
fi

# Remove the app user and group if they exist
if id "$APP_USER" >/dev/null 2>&1; then
  userdel --remove "$APP_USER" || true
fi
if getent group "$APP_GROUP" >/dev/null; then
  groupdel "$APP_GROUP" || true
fi

echo
