#!/bin/sh
# Convenience wrapper — runs any script from this directory without needing chmod
# Usage: sh scripts/run.sh seed [args...]
#        sh scripts/run.sh load-test --requests 300
#        sh scripts/run.sh alarm-test --mode set-alarm
#        sh scripts/run.sh purge --confirm

set -e
SCRIPT="$1"
shift || true

DIR="$(cd "$(dirname "$0")" && pwd)"

case "$SCRIPT" in
  seed)       bash "$DIR/seed.sh"       "$@" ;;
  load-test)  bash "$DIR/load-test.sh"  "$@" ;;
  alarm-test) bash "$DIR/alarm-test.sh" "$@" ;;
  purge)      bash "$DIR/purge.sh"      "$@" ;;
  *)
    echo "Usage: sh scripts/run.sh <seed|load-test|alarm-test|purge> [args...]"
    exit 1
    ;;
esac
