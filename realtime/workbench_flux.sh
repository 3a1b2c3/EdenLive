#!/usr/bin/env bash
# Start the FLUX coarse-to-fine worker on the GPU pod (127.0.0.1:8092).
#
# Usage: bash workbench_flux.sh [gpu-index]   (or FLUX_GPU=<n> bash workbench_flux.sh)
#
# Put it on a GPU the model app is not using, or on the last rank's: rank 0 owns
# Chromium and the proxy-DINO encode, so it is the worst one to share with.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
ENV=/mnt/workspace/envs/miniconda3/envs/wm
export PATH=$ENV/bin:$PATH PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1
# The env's ICU needs the env's libstdc++, not the pod's older system one.
export LD_PRELOAD=$ENV/lib/libstdc++.so.6
export CUDA_VISIBLE_DEVICES="${1:-${FLUX_GPU:-1}}"
pkill -f '[e]den.apps.workbench.flux_worker' 2>/dev/null || true
nohup setsid python -m eden.apps.workbench.flux_worker --host 127.0.0.1 --port 8092 \
  > .workbench_flux.log 2>&1 < /dev/null &
echo "flux worker pid=$!"
