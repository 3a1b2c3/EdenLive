#!/usr/bin/env bash
# Start the workbench bridge, which runs the game-generation jobs.
#
# Usage: bash workbench_bridge.sh [bind-ip]
#
# Runs on whichever host has the `claude` CLI installed -- not necessarily the
# GPU host. `claude` must be on PATH, already logged in and past the first-run
# trust prompt: the bridge runs it unattended and has no key of its own. Set
# EDEN_WORKBENCH_CLAUDE if the binary is not named `claude`.
#
# The address comes from BRIDGE_HOST in deploy.conf (or the argument), and has
# to be reachable from the GPU host, which proxies /ext/workbench/ to it. Both
# sides authenticate with the shared token in .workbench/token, created here on
# first run and readable only by its owner; copy it to the GPU host when the
# two are not the same machine.
#
# Activate the Python environment first; this script uses whatever `python` is
# on PATH.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"

HOST="${1:-${BRIDGE_HOST:-}}"
if [ -z "$HOST" ]; then
  HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
if [ -z "$HOST" ]; then
  echo "set BRIDGE_HOST in deploy.conf, or pass the bind address" >&2
  exit 1
fi

mkdir -p .workbench && chmod 700 .workbench
[ -s .workbench/token ] || (umask 077; python -c 'import secrets; print(secrets.token_urlsafe(24))' > .workbench/token)
export EDEN_WORKBENCH_TOKEN="$(cat .workbench/token)"
# The greybox capture runs on Chromium's software renderer, so this host needs
# no GPU. Its headless shell comes from `playwright install`.
export EDEN_GAME_GPU=0
pkill -f '[e]den.apps.workbench.bridge' 2>/dev/null || true
nohup setsid python -m eden.apps.workbench.bridge \
  --host "$HOST" --port "${BRIDGE_PORT:-8091}" \
  > .workbench/bridge.log 2>&1 < /dev/null &
echo "bridge pid=$! on ${HOST}:${BRIDGE_PORT:-8091} (log .workbench/bridge.log)"
echo "set BRIDGE_HOST=${HOST} in the GPU host's deploy.conf"
