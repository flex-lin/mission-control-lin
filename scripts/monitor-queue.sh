#!/usr/bin/env bash
# Queue + agent health monitor.
# Logs timestamped snapshots every 30s. Survives sleep/wake — the timestamp
# gap in the log is proof of what happened during sleep.
#
# Usage:
#   bash scripts/monitor-queue.sh            # runs in current terminal
#   bash scripts/monitor-queue.sh --daemon   # starts in mc-monitor tmux session

INTERVAL=30
LOG="$HOME/.claude/queue-monitor.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB="$SCRIPT_DIR/../prisma/mission-control.db"
HEARTBEAT="$HOME/.claude/queue-worker.heartbeat"
STALE_SECS=60

if [ "${1:-}" = "--daemon" ]; then
  SESSION="mc-monitor"
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  tmux new-session -d -s "$SESSION" "bash '$(realpath "$0")'"
  echo "Monitor started in tmux session: $SESSION"
  echo "Log file: $LOG"
  echo "Attach with: tmux attach-session -t $SESSION"
  exit 0
fi

echo "[monitor] Starting. Log → $LOG"
echo "[monitor] Press Ctrl+C to stop"
echo ""

log() {
  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$ts] $*" | tee -a "$LOG"
}

prev_snapshot=""

while true; do
  ts=$(date '+%Y-%m-%d %H:%M:%S')

  # Worker liveness
  worker_status="STOPPED"
  hb_age=""
  if [ -f "$HEARTBEAT" ]; then
    hb=$(cat "$HEARTBEAT")
    # Parse UTC ISO timestamp portably: strip fractional seconds and Z, then
    # let Python convert to epoch (avoids macOS date -jf local-time confusion)
    hb_epoch=$(python3 -c "
import sys, datetime
s = '${hb}'.replace('Z','').split('.')[0]
dt = datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc)
print(int(dt.timestamp()))
" 2>/dev/null)
    now_epoch=$(date '+%s')
    if [ -n "$hb_epoch" ]; then
      age=$(( now_epoch - hb_epoch ))
      hb_age="${age}s ago"
      if [ "$age" -lt "$STALE_SECS" ]; then
        worker_status="ALIVE"
      else
        worker_status="STALE(${age}s)"
      fi
    fi
  fi

  # Task summary from DB
  task_summary=$(sqlite3 "$DB" "
    SELECT
      status,
      COUNT(*) as cnt,
      GROUP_CONCAT(id) as ids
    FROM queued_tasks
    GROUP BY status
    ORDER BY CASE status
      WHEN 'running' THEN 0
      WHEN 'pending' THEN 1
      WHEN 'failed'  THEN 2
      WHEN 'completed' THEN 3
      ELSE 4 END;
  " 2>/dev/null || echo "DB_ERROR")

  # Running task detail
  running_detail=$(sqlite3 "$DB" "
    SELECT '#' || id || ' ' || team_name || ' (' || CAST(ROUND((julianday('now') - julianday(started_at)) * 1440) AS INTEGER) || 'min)'
    FROM queued_tasks WHERE status = 'running' LIMIT 3;
  " 2>/dev/null)

  # Tmux sessions (mc- prefix only)
  sessions=$(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep '^mc-' | tr '\n' ' ')

  snapshot="${worker_status}|${task_summary}|${sessions}"
  if [ "$snapshot" != "$prev_snapshot" ]; then
    log "━━━━━ CHANGE DETECTED ━━━━━"
  fi
  prev_snapshot="$snapshot"

  log "Worker=$worker_status hb=$hb_age"
  log "Tasks: $(echo "$task_summary" | awk -F'|' '{printf "%s=%s(ids:%s) ", $1, $2, $3}')"
  [ -n "$running_detail" ] && log "Running: $running_detail"
  log "Sessions: ${sessions:-none}"
  echo ""

  sleep "$INTERVAL"
done
