# Shared setup for the launch scripts. Sourced, not run.
#
# Reads deploy.conf, then exports what the Python side expects. Keep the
# deployment's own values in deploy.conf; this file only maps them.

# Run from the directory holding run.py and games/.
cd "$(dirname "$(readlink -f "${BASH_SOURCE[1]}")")" || exit 1

CONF=${EDEN_DEPLOY_CONF:-deploy.conf}
if [ ! -f "$CONF" ]; then
  echo "missing $CONF -- set EDEN_DEPLOY_CONF to your own copy" >&2
  exit 1
fi
# shellcheck disable=SC1090
. "$CONF"

# The weight tree. Relative paths in deploy.conf are repository-relative.
case "${MODEL_ROOT:-}" in
  "") echo "set MODEL_ROOT in $CONF to the weight tree" >&2; exit 1 ;;
  /*) ;;
  *) MODEL_ROOT="$(cd .. && pwd)/$MODEL_ROOT" ;;
esac
export EDEN_MODEL_ROOT="$MODEL_ROOT"
export HF_HUB_OFFLINE=1 PYTHONUNBUFFERED=1

# TURN. An empty TURN_HOST disables the relay, which the server reads as "no
# ICE servers" rather than a misconfiguration.
if [ -n "${TURN_HOST:-}" ]; then
  if [ -z "${TURN_SECRET:-}" ]; then
    echo "TURN_HOST is set in $CONF but TURN_SECRET is empty" >&2
    exit 1
  fi
  export FLASHDREAMS_TURN_HOST="$TURN_HOST" \
         FLASHDREAMS_TURN_PORT="${TURN_PORT:-3478}" \
         FLASHDREAMS_TURN_USERNAME="${TURN_USERNAME:-flashdreams}" \
         FLASHDREAMS_TURN_CREDENTIAL="$TURN_SECRET"
fi
