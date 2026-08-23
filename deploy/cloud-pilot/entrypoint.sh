#!/bin/sh
set -eu

required_vars="SMARTFARM_SITE_ADDRESS SMARTFARM_BASIC_AUTH_USER SMARTFARM_BASIC_AUTH_HASH SMARTFARM_DEMO_KEY"

for name in $required_vars; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "[smartfarm-cloud-pilot] missing required environment variable: $name" >&2
    exit 1
  fi
done

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
