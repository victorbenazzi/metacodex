#!/usr/bin/env bash
set -euo pipefail

desktop_file="/usr/share/applications/metacodex.desktop"
test -x /usr/bin/metacodex
test -f "$desktop_file"
desktop-file-validate "$desktop_file"
grep -Eq '^Exec=.*metacodex %F$' "$desktop_file"
grep -Eq '^MimeType=.*text/plain;.*application/pdf;$' "$desktop_file"
if command -v dpkg-query >/dev/null; then
  dpkg-query -W -f='${Recommends}\n' metacodex | grep -Eq '(^|, )xdg-utils($|, )'
else
  rpm -q --recommends metacodex | grep -Fxq xdg-utils
fi

runtime_dir="$(mktemp -d)"
state_dir="$(mktemp -d)"
log_file="$(mktemp)"
dbus_log="$(mktemp)"
chmod 700 "$runtime_dir"

set +e
DISPLAY=:99 \
GDK_BACKEND=x11 \
WEBKIT_DISABLE_COMPOSITING_MODE=1 \
XDG_RUNTIME_DIR="$runtime_dir" \
dbus-run-session -- bash -s -- "$runtime_dir" "$state_dir" "$log_file" >"$dbus_log" 2>&1 <<'METACODEX_SMOKE'
set -euo pipefail
runtime_dir="$1"
state_dir="$2"
log_file="$3"

Xvfb :99 -screen 0 1280x800x24 >"$log_file.xvfb" 2>&1 &
xvfb_pid=$!
trap 'kill "$xvfb_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  if [[ -S /tmp/.X11-unix/X99 ]]; then
    break
  fi
  sleep 0.1
done
test -S /tmp/.X11-unix/X99

set +e
DISPLAY=:99 \
GDK_BACKEND=x11 \
WEBKIT_DISABLE_COMPOSITING_MODE=1 \
XDG_RUNTIME_DIR="$runtime_dir" \
METACODEX_HOME="$state_dir" \
timeout --signal=TERM --kill-after=3s 8s /usr/bin/metacodex >"$log_file" 2>&1
status=$?
set -e

if [[ "$status" -ne 124 ]]; then
  cat "$log_file" >&2
  exit 1
fi
METACODEX_SMOKE
status=$?
set -e

if [[ "$status" -ne 0 ]]; then
  cat "$dbus_log" >&2
  cat "$log_file" >&2
  exit "$status"
fi
