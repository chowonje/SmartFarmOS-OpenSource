#!/bin/sh
set -eu

if [ -z "${SMARTFARM_SITE_ADDRESS:-}" ] \
  || [ -z "${SMARTFARM_BASIC_AUTH_USER:-}" ] \
  || [ -z "${SMARTFARM_BASIC_AUTH_HASH:-}" ] \
  || [ -z "${SMARTFARM_DEMO_KEY:-}" ]; then
  echo "[smartfarm-cloud-pilot] a required environment variable is missing" >&2
  exit 1
fi

node /app/scripts/run-local-demo.mjs --preview &
app_pid=$!

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

shutdown() {
  status=${1:-0}

  if kill -0 "$app_pid" 2>/dev/null; then
    kill -TERM "$app_pid" 2>/dev/null || true
  fi
  if kill -0 "$caddy_pid" 2>/dev/null; then
    kill -TERM "$caddy_pid" 2>/dev/null || true
  fi

  wait "$app_pid" 2>/dev/null || true
  wait "$caddy_pid" 2>/dev/null || true

  exit "$status"
}

trap 'shutdown 0' INT TERM

while true; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    wait "$app_pid" || status=$?
    shutdown "${status:-1}"
  fi

  if ! kill -0 "$caddy_pid" 2>/dev/null; then
    wait "$caddy_pid" || status=$?
    shutdown "${status:-1}"
  fi

  sleep 1
done
