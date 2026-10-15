#!/usr/bin/env bash
# Start the model app with the workbench, on the GPU host.
#
# Usage: bash launch.sh
#
# Starts the FLUX worker first if it is not running. The workbench bridge, and
# the TURN relay when TURN_HOST is set, must already be up. Settings come from
# deploy.conf. To play the registered games without the bridge, use start.sh.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"
APP=$(app_slug "$MODEL") || exit 1

[ -s .workbench/token ] || die "no .workbench/token: start workbench_bridge.sh first, or copy its token here"

export EDEN_WORKBENCH_BRIDGE="http://$BRIDGE_HOST:$BRIDGE_PORT"
export EDEN_WORKBENCH_FLUX="http://$FLUX_HOST:$FLUX_PORT"
export EDEN_WORKBENCH_TOKEN="$(cat .workbench/token)"

# A TURN_HOST with no relay behind it stalls the browser, so check it answers.
if [ -n "$TURN_HOST" ] && ! timeout 3 bash -c 'exec 3<>/dev/tcp/$0/$1' "$TURN_HOST" "$TURN_PORT" 2>/dev/null; then
  die "TURN relay $TURN_HOST:$TURN_PORT is unreachable; start turn_server.sh first"
fi

running flux || bash workbench_flux.sh

serve app .eden_app.log \
  python -m torch.distributed.run --nproc_per_node="$NPROC" run.py "$APP" \
  --mode webrtc --host "$APP_HOST" --port "$APP_PORT" -- \
  --no-ui --no-compile --total-blocks 10000 \
  --game "$GAME" --wait-for-start
echo "$APP on $NPROC GPUs, http://$APP_HOST:$APP_PORT/"
