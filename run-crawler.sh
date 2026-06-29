#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_DIR="$ROOT/.crawler.lock"
LOG_DIR="$ROOT/logs"
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
trap 'rm -rf "$LOCK_DIR"' EXIT

cd "$ROOT"
set -a
. "$ROOT/.env"
set +a
NODE_BIN="$(command -v node)"
"$NODE_BIN" index.js 2>&1 | tee -a "$LOG_DIR/crawler-$(date +%Y-%m-%d).log"
