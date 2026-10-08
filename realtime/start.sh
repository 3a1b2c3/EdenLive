#!/usr/bin/env bash
# Run a Game2V model without the workbench: renders from the first step, with
# no home screen and no game generation. Needs neither the bridge nor the FLUX
# worker.
#
# Usage: bash start.sh [model] [on|off]
#   model   eden-game2v-5b-taehv (default) or eden-game2v-14b-taehv
#   on|off  `off` disables transformer compilation, for when only
#           time-to-first-chunk matters
#
# Settings come from deploy.conf. Activate the Python environment first; this
# script uses whatever `torchrun` is on PATH.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"

MODEL="${1:-eden-game2v-5b-taehv}"
OPTIMIZE="${2:-on}"
case "$OPTIMIZE" in
  on|off) ;;
  *) echo "second argument must be on or off, got: ${OPTIMIZE}" >&2; exit 1 ;;
esac
case "$MODEL" in
  eden-game2v-5b-taehv) APP_SLUG="game2v-eden-world-v2-5b-taehv" ;;
  eden-game2v-14b-taehv) APP_SLUG="game2v-eden-world-v2-14b-taehv" ;;
  *)
    echo "unknown model: ${MODEL} (eden-game2v-5b-taehv, eden-game2v-14b-taehv)" >&2
    exit 1
    ;;
esac
echo "model: ${MODEL} -> ${APP_SLUG} (compile: ${OPTIMIZE})"

# The WebRTC server does not exit on its own, so a previous run holds the app
# port and torchrun's rendezvous port, and the next start fails with EADDRINUSE.
PORT="${APP_PORT:-8089}"
OLD_PID=$(ss -ltnp 2>/dev/null | grep ":${PORT} " | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n1)
if [ -n "$OLD_PID" ]; then
  echo "killing the process holding :${PORT} (pid=${OLD_PID})"
  kill -9 "$OLD_PID" 2>/dev/null || true
fi
pkill -9 -f '[r]un.py' 2>/dev/null || true

torchrun --nproc_per_node="${NPROC:-1}" run.py \
  "${APP_SLUG}" --mode webrtc --host "${APP_HOST:-0.0.0.0}" --port "${PORT}" -- \
  --no-ui --example-data --total-blocks 10000 \
  $(if [ "$OPTIMIZE" = off ]; then echo --no-compile; fi) \
  --game "${GAME:-subway-run}" \
  > .eden_app.log 2>&1 &
echo "app pid=$! on ${APP_HOST:-0.0.0.0}:${PORT} (log .eden_app.log)"
tail -f .eden_app.log
