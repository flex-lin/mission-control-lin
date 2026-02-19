#!/usr/bin/env bash
# Start all Mission Control services concurrently.
# Usage: pnpm dev:all   (or bash scripts/start-all.sh)

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$DIR/node_modules/.bin"

# --- Phase 1: Stop old processes FIRST (before touching .next) ---
# Turbopack uses LSM-tree SST files; deleting .next while a process holds
# open file descriptors corrupts the cache. Always stop, wait, THEN clean.
echo "Stopping any existing services..."
for port in 3777 8787; do
  if fuser "$port"/tcp >/dev/null 2>&1; then
    echo "  Sending SIGTERM to processes on port $port"
    fuser -TERM "$port"/tcp >/dev/null 2>&1 || true
  fi
done
pkill -TERM -f 'start-queue-worker' 2>/dev/null || true

# Wait for graceful shutdown (up to 6 seconds)
for port in 3777 8787; do
  for _ in $(seq 1 20); do
    fuser "$port"/tcp >/dev/null 2>&1 || break
    sleep 0.3
  done
  if fuser "$port"/tcp >/dev/null 2>&1; then
    echo "  Force-killing stubborn processes on port $port"
    fuser -KILL "$port"/tcp >/dev/null 2>&1 || true
    sleep 0.5  # let OS reclaim file descriptors after SIGKILL
  fi
done

# --- Phase 2: Clean cache AFTER all old processes are dead ---
if [ -d "$DIR/.next" ]; then
  echo "Cleaning stale .next cache..."
  rm -rf "$DIR/.next"
fi

# --- Shutdown handler: give Turbopack time to flush its cache ---
# Guard against re-entry (INT fires cleanup, then EXIT fires it again).
_cleaning_up=0
cleanup() {
  [ "$_cleaning_up" -ne 0 ] && return
  _cleaning_up=1
  echo ""
  echo "Shutting down all services..."
  # SIGTERM all children
  kill "$PID_DEV" "$PID_PROXY" "$PID_QUEUE" 2>/dev/null || true
  # Wait up to 5s for Next.js to flush its persistent cache
  for _ in $(seq 1 10); do
    kill -0 "$PID_DEV" 2>/dev/null || break
    sleep 0.5
  done
  # Force-kill anything still alive
  kill -9 "$PID_DEV" "$PID_PROXY" "$PID_QUEUE" 2>/dev/null || true
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
