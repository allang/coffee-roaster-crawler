#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_DIR="$ROOT/.crawler.lock"
LOG_DIR="$ROOT/logs"
STALL_TIMEOUT_SECONDS="${CRAWLER_STALL_TIMEOUT_SECONDS:-2700}"
WATCHDOG_CHECK_SECONDS="${CRAWLER_WATCHDOG_CHECK_SECONDS:-60}"
mkdir -p "$LOG_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -f "$LOCK_DIR/pid" ] && ! kill -0 "$(cat "$LOCK_DIR/pid")" 2>/dev/null; then
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR"
  else
    echo "$(date '+%Y-%m-%dT%H:%M:%S%z') crawler already running; skipping"
    exit 0
  fi
fi
printf '%s\n' $$ > "$LOCK_DIR/pid"

NODE_PID=""
WATCHDOG_PID=""

cleanup() {
  if [ -n "$WATCHDOG_PID" ]; then
    kill "$WATCHDOG_PID" 2>/dev/null || true
  fi
  if [ -n "$NODE_PID" ] && kill -0 "$NODE_PID" 2>/dev/null; then
    kill -TERM "$NODE_PID" 2>/dev/null || true
  fi
  rm -rf "$LOCK_DIR"
}

terminate() {
  exit 143
}

watch_for_stall() {
  local watched_pid="$1"
  local watched_log="$2"

  while kill -0 "$watched_pid" 2>/dev/null; do
    sleep "$WATCHDOG_CHECK_SECONDS"
    kill -0 "$watched_pid" 2>/dev/null || return 0

    local now
    local last_activity
    now="$(date +%s)"
    last_activity="$(stat -f %m "$watched_log")"

    if [ $((now - last_activity)) -ge "$STALL_TIMEOUT_SECONDS" ]; then
      printf '%s crawler watchdog: no log activity for %s seconds; terminating pid %s\n' \
        "$(date '+%Y-%m-%dT%H:%M:%S%z')" \
        "$STALL_TIMEOUT_SECONDS" \
        "$watched_pid" | tee -a "$watched_log" >&2

      kill -TERM "$watched_pid" 2>/dev/null || return 0
      local attempts=0
      while kill -0 "$watched_pid" 2>/dev/null && [ "$attempts" -lt 30 ]; do
        sleep 1
        attempts=$((attempts + 1))
      done
      if kill -0 "$watched_pid" 2>/dev/null; then
        kill -KILL "$watched_pid" 2>/dev/null || true
      fi
      return 0
    fi
  done
}

trap cleanup EXIT
trap terminate INT TERM

cd "$ROOT"
set -a
. "$ROOT/.env"
set +a
NODE_BIN="$(command -v node)"
LOG_FILE="$LOG_DIR/crawler-$(date +%Y-%m-%d).log"
touch "$LOG_FILE"

"$NODE_BIN" index.js > >(tee -a "$LOG_FILE") 2>&1 &
NODE_PID="$!"
watch_for_stall "$NODE_PID" "$LOG_FILE" &
WATCHDOG_PID="$!"

set +e
wait "$NODE_PID"
NODE_STATUS="$?"
set -e

kill "$WATCHDOG_PID" 2>/dev/null || true
wait "$WATCHDOG_PID" 2>/dev/null || true
WATCHDOG_PID=""
NODE_PID=""

exit "$NODE_STATUS"
