#!/usr/bin/env bash
# Run a model without the workbench: it renders GAME from the first step, with
# no home screen. Needs neither the bridge nor the FLUX worker.
#
# Usage: bash start.sh [14b|5b] [--no-compile]
#
# The model defaults to MODEL in deploy.conf. --no-compile skips transformer
# compilation, for when only time-to-first-chunk matters.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"
APP=$(app_slug "${1:-$MODEL}") || exit 1
COMPILE="${2:-}"

pkill -9 -f '[r]un.py' 2>/dev/null || true

torchrun --nproc_per_node="$NPROC" run.py "$APP" \
  --mode webrtc --host "$APP_HOST" --port "$APP_PORT" -- \
  --no-ui --total-blocks 10000 $COMPILE \
  --game "$GAME" \
  > .eden_app.log 2>&1 &
echo "$APP on $NPROC GPUs, pid $!, http://$APP_HOST:$APP_PORT/ (log .eden_app.log)"
tail -f .eden_app.log
