#!/bin/sh
set -eu

KUMA_PORT="${KUMA_PORT:-3001}"
GATEWAY_PORT="${PORT:-8080}"
export KUMA_UPSTREAM="${KUMA_UPSTREAM:-http://127.0.0.1:${KUMA_PORT}}"
export BASE_URL="${BASE_URL:-https://status.processpro.io}"

echo "Starting Uptime Kuma on ${KUMA_PORT}"
(
  cd /app
  # Keep Azure / gateway PORT from overriding Kuma's listen port.
  env -u PORT UPTIME_KUMA_PORT="${KUMA_PORT}" node server/server.js
) &
KUMA_PID=$!

cleanup() {
  kill "$KUMA_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Waiting for Uptime Kuma..."
ready=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:${KUMA_PORT}/" >/dev/null 2>&1 \
    || curl -fsS "http://127.0.0.1:${KUMA_PORT}/dashboard" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "Uptime Kuma did not become ready in time" >&2
  exit 1
fi

echo "Starting status gateway on ${GATEWAY_PORT}"
export PORT="${GATEWAY_PORT}"
cd /opt/status-gateway
exec node src/server.js
