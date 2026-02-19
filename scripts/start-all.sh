#!/usr/bin/env bash
# Start all Mission Control services concurrently.
# Usage: pnpm dev:all   (or bash scripts/start-all.sh)

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$DIR/node_modules/.bin"

# Clear stale Turbopack cache to prevent corruption
if [ -d "$DIR/.next" ]; then
  echo "Cleaning stale .next cache..."
  rm -rf "$DIR/.next"
fi

# Kill any existing services on our ports / from a previous run
echo "Stopping any existing services..."
for port in 3777 8787; do
  # Use fuser which reliably finds listeners on both IPv4 and IPv6
  if fuser "$port"/tcp >/dev/null 2>&1; then
    echo "  Killing processes on port $port"
    fuser -k "$port"/tcp >/dev/null 2>&1 || true
  fi
done
pkill -9 -f 'start-queue-worker' 2>/dev/null || true

# Wait until ports are actually free
for port in 3777 8787; do
  for _ in $(seq 1 20); do
    fuser "$port"/tcp >/dev/null 2>&1 || break
    sleep 0.3
  done
done

cleanup() {
  echo ""
  echo "Shutting down all services..."
  kill $PID_DEV $PID_PROXY $PID_QUEUE 2>/dev/null || true
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "Starting Mission Control services..."
echo "  Next.js   → http://localhost:3777"
echo "  Proxy     → http://localhost:8787"
echo "  Queue     → background worker"
echo ""

"$BIN/next" dev --port 3777 &
PID_DEV=$!

"$BIN/tsx" --tsconfig "$DIR/tsconfig.server.json" "$DIR/server/start-proxy.ts" &
PID_PROXY=$!

"$BIN/tsx" --tsconfig "$DIR/tsconfig.server.json" "$DIR/server/start-queue-worker.ts" &
PID_QUEUE=$!

wait
