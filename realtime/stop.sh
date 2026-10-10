#!/usr/bin/env bash
# Stop the Game2V realtime services: the model app, the FLUX worker, the
# workbench bridge and the TURN relay.
#
# Usage: bash stop.sh
#
# Each service runs on its own host, so this only stops the ones present on
# the machine it runs on: the model app and the FLUX worker on the GPU host,
# the bridge on the host with the `claude` CLI, the relay wherever
# turn_server.sh was started. Run it on each host that has services up.
set -u
cd "$(dirname "$(readlink -f "$0")")" || exit 1

stopped=0
stop() {
  local label="$1" pattern="$2"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    pkill -9 -f "$pattern" 2>/dev/null || true
    echo "stopped ${label}"
    stopped=$((stopped + 1))
  fi
}

# The model app. torchrun's child is run.py; killing the parent reaps the
# ranks, which is what frees the app port and the rendezvous port.
stop "model app" '[r]un.py'
stop "FLUX worker" '[e]den.apps.workbench.flux_worker'
stop "workbench bridge" '[e]den.apps.workbench.bridge'
stop "TURN relay" '[t]urnserver'

if [ "$stopped" -eq 0 ]; then
  echo "no realtime services running"
else
  echo "${stopped} stopped"
fi
