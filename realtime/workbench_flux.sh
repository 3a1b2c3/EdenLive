#!/usr/bin/env bash
# Start the FLUX coarse-to-fine worker, which renders the photoreal first frame.
#
# Usage: bash workbench_flux.sh [gpu-index]
#
# Runs on the GPU host: the app reaches it over loopback. Settings come from
# deploy.conf (FLUX_HOST, FLUX_PORT, FLUX_GPU).
#
# Activate the Python environment first; this script uses whatever `python` is
# on PATH.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"

export CUDA_VISIBLE_DEVICES="${1:-${FLUX_GPU:-0}}"
pkill -f '[e]den.apps.workbench.flux_worker' 2>/dev/null || true
nohup setsid python -m eden.apps.workbench.flux_worker \
  --host "${FLUX_HOST:-127.0.0.1}" --port "${FLUX_PORT:-8092}" \
  > .workbench_flux.log 2>&1 < /dev/null &
echo "flux worker pid=$! on ${FLUX_HOST:-127.0.0.1}:${FLUX_PORT:-8092}" \
     "(gpu ${CUDA_VISIBLE_DEVICES}, log .workbench_flux.log)"
