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
export EDEN_GAME_GPU=0   # greybox capture uses Chromium's software renderer

serve bridge .workbench/bridge.log \
  python -m eden.apps.workbench.bridge --host "$HOST" --port "$BRIDGE_PORT"
echo "on the GPU host, set BRIDGE_HOST=$HOST"
