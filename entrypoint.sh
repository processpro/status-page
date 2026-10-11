#!/bin/sh
set -eu

KUMA_PORT="${KUMA_PORT:-3001}"
GATEWAY_PORT="${PORT:-8080}"
export KUMA_UPSTREAM="${KUMA_UPSTREAM:-http://127.0.0.1:${KUMA_PORT}}"
export BASE_URL="${BASE_URL:-https://status.processpro.io}"

echo "Starting Uptime Kuma on ${KUMA_PORT}"
(
  cd /app
  while true; do
    # Keep Azure / gateway PORT from overriding Kuma's listen port.
    env -u PORT UPTIME_KUMA_PORT="${KUMA_PORT}" node server/server.js || true
    echo "Uptime Kuma exited; restarting in 5s"
    sleep 5
  done
) &
KUMA_PID=$!

cleanup() {
  kill "$KUMA_PID" 2>/dev/null || true
}
trap cleanup INT TERM

echo "Starting status gateway on ${GATEWAY_PORT}"
export PORT="${GATEWAY_PORT}"
cd /opt/status-gateway
exec node src/server.js
