#!/usr/bin/env bash
# Start all Mission Control services concurrently.
# Usage: pnpm dev:all   (or bash scripts/start-all.sh)

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$DIR/node_modules/.bin"
PIDFILE="$DIR/.mc-dev.pgid"

# ── Helpers ──────────────────────────────────────────────────────────────────

# Get the PGID for a given PID (Linux /proc).
pgid_of() { awk '{print $5}' "/proc/$1/stat" 2>/dev/null; }

# Kill an entire process group: SIGTERM, wait, then SIGKILL.
kill_pgid() {
  local pgid="$1"
  [ -z "$pgid" ] && return
  kill -0 -- "-$pgid" 2>/dev/null || return 0
  echo "  Sending SIGTERM to process group $pgid"
  kill -- "-$pgid" 2>/dev/null || true
  for _ in $(seq 1 10); do
    kill -0 -- "-$pgid" 2>/dev/null || return 0
    sleep 0.5
  done
  echo "  Force-killing process group $pgid"
  kill -9 -- "-$pgid" 2>/dev/null || true
  sleep 0.5
}

# ── Phase 1: Kill previous instance ─────────────────────────────────────────
# fuser only finds the leaf process (next-server) holding the socket FD, not
# the parent tree (pnpm → sh → bash → next-cli → next-server). Killing the
# leaf leaves 6+ parent processes alive which hold/re-bind the port.
# Instead we save the PGID on startup and kill the entire group next time.
echo "Stopping any existing services..."

# Primary: kill by saved PGID
if [ -f "$PIDFILE" ]; then
  OLD_PGID=$(cat "$PIDFILE" 2>/dev/null || true)
  kill_pgid "$OLD_PGID"
  rm -f "$PIDFILE"
fi

# Fallback: if ports still occupied (e.g. orphan from manual `next dev`),
# resolve the leaf PID's PGID and kill the whole group.
for port in 31777 28787; do
  LEAF_PID=$(fuser "$port"/tcp 2>/dev/null | awk '{print $1}') || true
  if [ -n "$LEAF_PID" ]; then
    LEAF_PGID=$(pgid_of "$LEAF_PID")
    if [ -n "$LEAF_PGID" ]; then
      echo "  Port $port still held by PID $LEAF_PID (PGID $LEAF_PGID)"
      kill_pgid "$LEAF_PGID"
    fi
    # Also kill the leaf PID directly — it may have a different PGID
    # or may have been reparented after the group leader exited.
    if kill -0 "$LEAF_PID" 2>/dev/null; then
      echo "  Killing PID $LEAF_PID directly"
      kill "$LEAF_PID" 2>/dev/null || true
      sleep 1
      kill -0 "$LEAF_PID" 2>/dev/null && kill -9 "$LEAF_PID" 2>/dev/null || true
    fi
  fi
done
pkill -TERM -f 'start-queue-worker' 2>/dev/null || true

# Wait for ports to actually be released after killing processes
for port in 31777 28787; do
  for _ in $(seq 1 20); do
    fuser "$port"/tcp 2>/dev/null || break
    sleep 0.5
  done
  # Last resort: force-kill anything still on the port
  if fuser "$port"/tcp 2>/dev/null; then
    echo "  Force-killing remaining process on port $port"
    fuser -KILL "$port"/tcp 2>/dev/null || true
    sleep 1
  fi
done

# ── Phase 2: Clean cache AFTER all old processes are dead ────────────────────
# Turbopack uses LSM-tree SST files; deleting .next while a process holds
# open file descriptors corrupts the persistent cache.
if [ -d "$DIR/.next" ]; then
  echo "Cleaning stale .next cache..."
  rm -rf "$DIR/.next"
fi

# ── Phase 3: Start services ─────────────────────────────────────────────────
_cleaning_up=0
cleanup() {
  [ "$_cleaning_up" -ne 0 ] && return
  _cleaning_up=1
  echo ""
  echo "Shutting down all services..."
  MY_PGID=$(pgid_of $$)
  if [ -n "$MY_PGID" ]; then
    kill -- "-$MY_PGID" 2>/dev/null || true
  else
    kill "$PID_DEV" "$PID_PROXY" "$PID_QUEUE" 2>/dev/null || true
  fi
  # Wait up to 5s for Next.js/Turbopack to flush its persistent cache
  for _ in $(seq 1 10); do
    kill -0 "$PID_DEV" 2>/dev/null || break
    sleep 0.5
  done
  if [ -n "$MY_PGID" ]; then
    kill -9 -- "-$MY_PGID" 2>/dev/null || true
  else
    kill -9 "$PID_DEV" "$PID_PROXY" "$PID_QUEUE" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "Starting Mission Control services..."
echo "  Next.js   → http://localhost:31777"
echo "  Proxy     → http://localhost:28787"
echo "  Queue     → background worker"
echo ""

"$BIN/next" dev --port 31777 &
PID_DEV=$!

"$BIN/tsx" --tsconfig "$DIR/tsconfig.server.json" "$DIR/server/start-proxy.ts" &
PID_PROXY=$!

"$BIN/tsx" --tsconfig "$DIR/tsconfig.server.json" "$DIR/server/start-queue-worker.ts" &
PID_QUEUE=$!

# Save the PGID (may differ from $$ if we inherit parent's process group)
pgid_of $$ > "$PIDFILE"

wait
