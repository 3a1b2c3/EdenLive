#!/usr/bin/env bash
# Launch the Game2V workbench: the model app plus the FLUX worker it needs.
#
# Usage: bash launch.sh
#
# The page opens on the workbench home screen and waits there: nothing renders
# until a game is picked, so GAME in deploy.conf only decides which cover the
# first switch leaves behind. Slugs come from games/registry.json.
#
# Settings come from deploy.conf. Expects the workbench bridge and, unless
# TURN_HOST is empty, the TURN relay to be up already -- see the "Launch the
# workbench" section of README.md for the order.
#
# Activate the Python environment first; this script uses whatever `torchrun`
# is on PATH.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"

# Rank 0 proxies /ext/workbench/ to the bridge and the FLUX worker.
if [ -z "${BRIDGE_HOST:-}" ]; then
  echo "set BRIDGE_HOST in deploy.conf to the host running workbench_bridge.sh" >&2
  exit 1
fi
export EDEN_WORKBENCH_BRIDGE="http://${BRIDGE_HOST}:${BRIDGE_PORT:-8091}"
export EDEN_WORKBENCH_FLUX="http://${FLUX_HOST:-127.0.0.1}:${FLUX_PORT:-8092}"
# Both sides authenticate with this; the bridge writes it on its first run.
if [ ! -s .workbench/token ]; then
  echo "no .workbench/token -- start workbench_bridge.sh first, or copy its" \
       "token here if the bridge runs on another host" >&2
  exit 1
fi
export EDEN_WORKBENCH_TOKEN="$(cat .workbench/token)"

pgrep -f '[e]den.apps.workbench.flux_worker' >/dev/null || bash workbench_flux.sh
pkill -9 -f '[r]un.py' 2>/dev/null || true
nohup setsid torchrun --nproc_per_node="${NPROC:-1}" run.py \
  game2v-eden-world-v2-5b-taehv --mode webrtc \
  --host "${APP_HOST:-0.0.0.0}" --port "${APP_PORT:-8089}" -- \
  --no-ui --example-data --total-blocks 10000 --no-compile \
  --game "${GAME:-subway-run}" --wait-for-start \
  > .eden_app.log 2>&1 < /dev/null &
echo "app pid=$! on ${APP_HOST:-0.0.0.0}:${APP_PORT:-8089} (log .eden_app.log)"
