#!/usr/bin/env bash
# Launch the Game2V workbench: the model app plus the FLUX worker it needs.
#
# Usage:
#   bash launch.sh                      # as many ranks as NPROC says (default 2)
#   NPROC=8 bash launch.sh              # eight ranks
#   GAME=need-for-speed bash launch.sh  # a different game behind the start gate
#
# The page opens on the workbench home screen and waits there: nothing renders
# until a game is picked, so GAME only decides which cover the first switch
# leaves behind. Slugs come from games/registry.json.
#
# Expects the workbench bridge and the TURN relay to be up already -- see the
# "Launch the workbench" section of README.md for the order.
set -u
cd "$(dirname "$(readlink -f "$0")")" || exit 1
ENV=/mnt/workspace/envs/miniconda3/envs/wm
export PATH=$ENV/bin:$PATH
# Weights come from the EdenLive tree, not an HF cache. The CPFS mount point
# differs between the notebook and the pod, so the default follows whichever
# exists; EDEN_MODEL_ROOT overrides it.
if [ -z "${EDEN_MODEL_ROOT:-}" ]; then
  if [ -d /mnt/workspace/models/EdenLive ]; then
    EDEN_MODEL_ROOT=/mnt/workspace/models/EdenLive
  else
    EDEN_MODEL_ROOT=/mnt/workspace/models/EdenLive
  fi
fi
export EDEN_MODEL_ROOT HF_HUB_OFFLINE=1 PYTHONUNBUFFERED=1
# mediapy -> IPython -> sqlite3 pulls the env's ICU, which needs the env's newer
# libstdc++ (CXXABI_1.3.15) rather than the pod's system one.
export LD_PRELOAD=$ENV/lib/libstdc++.so.6
# TURN must stay on: a browser outside the pod's subnet has no direct UDP path
# and its peer connection stalls in "connecting" without the relay. (A STUN
# probe to this host from the pod gets no answer, but that does not mean the
# relay is down -- a TURN server can ignore unauthenticated binding requests.)
export FLASHDREAMS_TURN_HOST=${TURN_HOST:-localhost} FLASHDREAMS_TURN_PORT=3478 \
       FLASHDREAMS_TURN_USERNAME=flashdreams FLASHDREAMS_TURN_CREDENTIAL=turnsecret
# Workbench: rank 0 proxies /ext/workbench/ to the bridge and the FLUX worker.
export EDEN_WORKBENCH_BRIDGE=${WORKBENCH_BRIDGE:-http://localhost:8091}
export EDEN_WORKBENCH_FLUX=http://127.0.0.1:8092
export EDEN_WORKBENCH_TOKEN="$(cat .workbench/token 2>/dev/null)"
pgrep -f '[e]den.apps.workbench.flux_worker' >/dev/null || bash workbench_flux.sh
pkill -9 -f '[r]un.py' 2>/dev/null || true
nohup setsid torchrun --nproc_per_node="${NPROC:-2}" run.py \
  game2v-eden-world-v2-5b-taehv --mode webrtc --host 0.0.0.0 --port 8089 -- \
  --no-ui --example-data --total-blocks 10000 --no-compile \
  --game "${GAME:-subway-run}" --wait-for-start \
  > .eden_app.log 2>&1 < /dev/null &
echo "app pid=$! on 0.0.0.0:8089 (log .eden_app.log); open http://localhost:8089/"
