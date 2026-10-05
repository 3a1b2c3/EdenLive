#!/usr/bin/env bash
# Start the workbench bridge on the host that has the `claude` CLI (the DSW
# notebook). The GPU pod's /ext/workbench/ proxy reaches it with the shared
# token in .workbench/token (created on first run, readable only by owner).
# Usage: bash workbench_bridge.sh [bind-ip]   (default localhost)
cd "$(dirname "$(readlink -f "$0")")" || exit 1
ENV=/mnt/workspace/envs/miniconda3/envs/wm
mkdir -p .workbench && chmod 700 .workbench
[ -s .workbench/token ] || (umask 077; "$ENV/bin/python" -c 'import secrets; print(secrets.token_urlsafe(24))' > .workbench/token)
export EDEN_WORKBENCH_TOKEN="$(cat .workbench/token)"
export PATH=$ENV/bin:$PATH PYTHONUNBUFFERED=1
# DSW has no GPU: the greybox capture runs on Chromium's software renderer.
# Its headless shell must match the env's Playwright (copy it from the pod if
# `playwright install` cannot download). Same libstdc++ fix as the pod.
export EDEN_GAME_GPU=0 LD_PRELOAD=$ENV/lib/libstdc++.so.6
pkill -f '[e]den.apps.workbench.bridge' 2>/dev/null || true
nohup setsid python -m eden.apps.workbench.bridge --host "${1:-localhost}" --port 8091 \
  > .workbench/bridge.log 2>&1 < /dev/null &
echo "bridge pid=$! on ${1:-localhost}:8091 (log .workbench/bridge.log)"
