#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_FILE="/etc/systemd/system/tb-meter.service"
RUN_USER="${SUDO_USER:-$USER}"
BOOT_CONFIG=""
BOOT_CMDLINE=""

if [[ -f /boot/firmware/config.txt ]]; then
  BOOT_CONFIG="/boot/firmware/config.txt"
elif [[ -f /boot/config.txt ]]; then
  BOOT_CONFIG="/boot/config.txt"
fi

if [[ -f /boot/firmware/cmdline.txt ]]; then
  BOOT_CMDLINE="/boot/firmware/cmdline.txt"
elif [[ -f /boot/cmdline.txt ]]; then
  BOOT_CMDLINE="/boot/cmdline.txt"
fi

set_config_value() {
  local file="$1"
  local key="$2"
  local value="$3"

  if sudo grep -qE "^[#[:space:]]*${key}=" "$file"; then
    sudo sed -i -E "s|^[#[:space:]]*${key}=.*|${key}=${value}|" "$file"
  else
    printf "\n%s=%s\n" "$key" "$value" | sudo tee -a "$file" >/dev/null
  fi
}

append_cmdline_flag() {
  local flag="$1"
  if [[ -z "$BOOT_CMDLINE" ]]; then
    return
  fi

  if ! sudo awk -v flag="$flag" '{ for (i = 1; i <= NF; i++) if ($i == flag) found = 1 } END { exit(found ? 0 : 1) }' "$BOOT_CMDLINE"; then
    sudo sed -i "s/$/ $flag/" "$BOOT_CMDLINE"
  fi
}

remove_cmdline_flag() {
  local flag="$1"
  if [[ -z "$BOOT_CMDLINE" ]]; then
    return
  fi

  sudo sed -i -E "s/(^| )${flag}( |$)/ /g; s/  +/ /g; s/^ //; s/ $//" "$BOOT_CMDLINE"
}

chmod +x "$APP_DIR/tb-meter-start.sh"

if [[ -n "$BOOT_CONFIG" ]]; then
  sudo cp "$BOOT_CONFIG" "$BOOT_CONFIG.tb-meter.bak"
  set_config_value "$BOOT_CONFIG" "disable_splash" "1"
fi

if [[ -n "$BOOT_CMDLINE" ]]; then
  sudo cp "$BOOT_CMDLINE" "$BOOT_CMDLINE.tb-meter.bak"
  remove_cmdline_flag "splash"
  append_cmdline_flag "quiet"
  append_cmdline_flag "logo.nologo"
  append_cmdline_flag "vt.global_cursor_default=0"
  append_cmdline_flag "loglevel=3"
  append_cmdline_flag "systemd.show_status=false"
fi

if systemctl list-unit-files plymouth-start.service >/dev/null 2>&1; then
  sudo systemctl disable --now plymouth-start.service >/dev/null 2>&1 || true
fi

sudo tee "$SERVICE_FILE" >/dev/null <<SERVICE
[Unit]
Description=TB Meter Raspberry Pi width measurement app
After=graphical.target display-manager.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
Environment=DISPLAY=:0
Environment=XDG_SESSION_TYPE=x11
Environment=WIDTH_SPLASH_IMAGE_PATH=$APP_DIR/splash_image.png
Environment=WIDTH_FONT_THICKNESS_SCALE=0.55
ExecStart=$APP_DIR/tb-meter-start.sh
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable tb-meter.service
sudo systemctl restart tb-meter.service
sudo systemctl status tb-meter.service --no-pager

echo
echo "TB Meter autostart installed."
echo "Reboot the Raspberry Pi to verify that the OS boot splash is hidden and the TB Meter splash appears first."
