#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="/etc/systemd/system/tb-meter.service"
RUN_USER="${SUDO_USER:-$USER}"

sudo tee "$SERVICE_FILE" >/dev/null <<SERVICE
[Unit]
Description=TB Meter Raspberry Pi width measurement app
After=graphical.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
Environment=DISPLAY=:0
Environment=XDG_SESSION_TYPE=x11
ExecStart=/usr/bin/python3 $APP_DIR/pi_width_cloud_app.py
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable tb-meter.service
sudo systemctl restart tb-meter.service
sudo systemctl status tb-meter.service --no-pager
