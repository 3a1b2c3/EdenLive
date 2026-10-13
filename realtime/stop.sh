#!/usr/bin/env bash
# Stop the services this deployment started: the model app, the FLUX worker,
# the workbench bridge and the TURN relay.
#
# Usage: bash stop.sh
#
# A service only runs on its own host, so this stops whichever of them were
# started here. Run it on each host that has services up.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"

stopped=0
for name in app flux bridge turn; do
  stop_service "$name" && stopped=$((stopped + 1))
done

if [ "$stopped" -eq 0 ]; then
  echo "no realtime services running"
else
  echo "$stopped stopped"
fi
