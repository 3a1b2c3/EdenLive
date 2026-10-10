#!/usr/bin/env bash
# Start the model app with the workbench, on the GPU host.
#
# Usage: bash launch.sh
#
# Starts the FLUX worker too if it is not running. Expects the workbench
# bridge (workbench_bridge.sh) and, if TURN_HOST is set, the TURN relay
# (turn_server.sh) to be up already. Settings come from deploy.conf.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"
APP=$(app_slug "$MODEL") || exit 1

# The bridge writes the shared token on its first run.
if [ -z "$BRIDGE_HOST" ]; then
  echo "set BRIDGE_HOST to the host running workbench_bridge.sh" >&2
  exit 1
fi
if [ ! -s .workbench/token ]; then
  echo "no .workbench/token: start workbench_bridge.sh first, or copy its token here" >&2
  exit 1
fi
export EDEN_WORKBENCH_BRIDGE="http://$BRIDGE_HOST:$BRIDGE_PORT"
export EDEN_WORKBENCH_FLUX="http://$FLUX_HOST:$FLUX_PORT"
export EDEN_WORKBENCH_TOKEN="$(cat .workbench/token)"

# A TURN_HOST with no relay behind it is worse than none; check it first.
if [ -n "$TURN_HOST" ] && ! timeout 3 bash -c 'exec 3<>/dev/tcp/$0/$1' "$TURN_HOST" "$TURN_PORT" 2>/dev/null; then
  echo "TURN relay $TURN_HOST:$TURN_PORT is unreachable; start turn_server.sh first" >&2
  exit 1
fi

pgrep -f '[e]den.apps.workbench.flux_worker' >/dev/null || bash workbench_flux.sh
pkill -9 -f '[r]un.py' 2>/dev/null || true

nohup setsid torchrun --nproc_per_node="$NPROC" run.py "$APP" \
  --mode webrtc --host "$APP_HOST" --port "$APP_PORT" -- \
  --no-ui --no-compile --total-blocks 10000 \
  --game "$GAME" --wait-for-start \
  > .eden_app.log 2>&1 < /dev/null &
echo "$APP on $NPROC GPUs, pid $!, http://$APP_HOST:$APP_PORT/ (log .eden_app.log)"
