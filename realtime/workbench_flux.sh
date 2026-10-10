#!/usr/bin/env bash
# Start the FLUX worker, which renders the photoreal first frame, on the GPU host.
#
# Usage: bash workbench_flux.sh
#
# Runs on FLUX_GPU. With FLUX_OFFLOAD=1 it shares that GPU with a model rank.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"

if [ "$FLUX_OFFLOAD" = 1 ]; then OFFLOAD=--offload; else OFFLOAD=--no-offload; fi

pkill -f '[e]den.apps.workbench.flux_worker' 2>/dev/null || true
CUDA_VISIBLE_DEVICES="$FLUX_GPU" nohup setsid python -m eden.apps.workbench.flux_worker \
  --host "$FLUX_HOST" --port "$FLUX_PORT" $OFFLOAD \
  > .workbench_flux.log 2>&1 < /dev/null &
echo "FLUX worker on GPU $FLUX_GPU, pid $!, $FLUX_HOST:$FLUX_PORT (log .workbench_flux.log)"
