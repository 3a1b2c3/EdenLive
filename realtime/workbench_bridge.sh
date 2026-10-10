#!/usr/bin/env bash
# Start the workbench bridge, which runs the game-generation jobs.
#
# Usage: bash workbench_bridge.sh
#
# Runs on the host that has the `claude` CLI, which need not be the GPU host.
# `claude` must be on PATH, logged in and past its first-run trust prompt: the
# bridge runs it unattended and has no key of its own.
#
# The first run writes the token both sides authenticate with to
# .workbench/token. Copy it to the GPU host if that is another machine.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"

HOST="${BRIDGE_HOST:-$(hostname -I | awk '{print $1}')}"

mkdir -p .workbench && chmod 700 .workbench
if [ ! -s .workbench/token ]; then
  (umask 077; python -c 'import secrets; print(secrets.token_urlsafe(24))' > .workbench/token)
fi
export EDEN_WORKBENCH_TOKEN="$(cat .workbench/token)"
# Greybox capture runs on Chromium's software renderer; this host needs no GPU.
export EDEN_GAME_GPU=0

pkill -f '[e]den.apps.workbench.bridge' 2>/dev/null || true
nohup setsid python -m eden.apps.workbench.bridge --host "$HOST" --port "$BRIDGE_PORT" \
  > .workbench/bridge.log 2>&1 < /dev/null &
echo "bridge pid $!, $HOST:$BRIDGE_PORT (log .workbench/bridge.log)"
echo "on the GPU host, set BRIDGE_HOST=$HOST"
