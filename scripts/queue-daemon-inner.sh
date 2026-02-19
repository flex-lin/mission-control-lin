#!/usr/bin/env bash
# Inner script that runs inside the mc-queue-worker tmux session.
# Sources nvm/pnpm, then runs the queue worker with auto-restart on crash.

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# Load nvm
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  source "$NVM_DIR/nvm.sh"
  nvm use 22 2>/dev/null || true
fi

# Load pnpm
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME:$PATH"

echo "=== Mission Control Queue Worker Daemon ==="
echo "Project : $DIR"
echo "Node    : $(node --version 2>/dev/null || echo 'not found')"
echo "Started : $(date)"
echo "==========================================="
echo ""

while true; do
  echo "[daemon] Starting queue worker at $(date)..."
  # caffeinate -i prevents system idle sleep while the worker is running.
  # When the worker exits (tasks done or crash), sleep is re-allowed.
  # On Linux, caffeinate is not available — fall back to running without it.
  EXIT_CODE=0
  if command -v caffeinate &>/dev/null; then
    caffeinate -i pnpm queue || EXIT_CODE=$?
  else
    pnpm queue || EXIT_CODE=$?
  fi
  if [ "$EXIT_CODE" -eq 0 ]; then
    echo "[daemon] Worker exited cleanly. Daemon stopped."
    break
  fi
  echo "[daemon] Worker crashed (exit $EXIT_CODE). Restarting in 5s..."
  sleep 5
done
