#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
export PYTHONUNBUFFERED=1
export WIDTH_SPLASH_IMAGE_PATH="${WIDTH_SPLASH_IMAGE_PATH:-$APP_DIR/splash_image.png}"
export WIDTH_SPLASH_IMAGE_SCALE="${WIDTH_SPLASH_IMAGE_SCALE:-0.35}"
export WIDTH_FONT_THICKNESS_SCALE="${WIDTH_FONT_THICKNESS_SCALE:-0.55}"

if command -v xset >/dev/null 2>&1; then
  xset s off -dpms s noblank >/dev/null 2>&1 || true
fi

if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.1 -root >/dev/null 2>&1 &
fi

if command -v xdpyinfo >/dev/null 2>&1; then
  for _ in $(seq 1 60); do
    if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

exec /usr/bin/python3 "$APP_DIR/pi_width_cloud_app.py"
