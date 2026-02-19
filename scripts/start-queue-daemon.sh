#!/usr/bin/env bash
# Start (or restart) the queue worker in a persistent tmux session.
# Usage: pnpm queue:daemon
#   or:  bash scripts/start-queue-daemon.sh

SESSION="mc-queue-worker"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INNER_SCRIPT="$SCRIPT_DIR/queue-daemon-inner.sh"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Stopping existing session..."
  tmux kill-session -t "$SESSION" 2>/dev/null || true
fi

tmux new-session -d -s "$SESSION" "bash '$INNER_SCRIPT'"
echo "Queue worker started in tmux session: $SESSION"
echo "Attach with: tmux attach-session -t $SESSION"
