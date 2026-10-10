# Shared setup for the launch scripts. Sourced, not run.
#
# Loads deploy.conf, then deploy.local.conf if it exists, and exports what the
# Python side reads.

# Run from realtime/, where run.py and games/ live.
cd "$(dirname "$(readlink -f "${BASH_SOURCE[1]}")")" || exit 1

. ./deploy.conf
if [ -f deploy.local.conf ]; then
  . ./deploy.local.conf
fi

# The weight tree. A relative MODEL_ROOT is read from the Eden repository root.
case "$MODEL_ROOT" in
  "") echo "set MODEL_ROOT in deploy.local.conf" >&2; exit 1 ;;
  /*) ;;
  *) MODEL_ROOT="$(cd .. && pwd)/$MODEL_ROOT" ;;
esac
export EDEN_MODEL_ROOT="$MODEL_ROOT"
export HF_HUB_OFFLINE=1 PYTHONUNBUFFERED=1

# TURN relay. An empty TURN_HOST means no relay.
if [ -n "$TURN_HOST" ]; then
  if [ -z "$TURN_SECRET" ]; then
    echo "TURN_HOST is set but TURN_SECRET is empty" >&2
    exit 1
  fi
  export FLASHDREAMS_TURN_HOST="$TURN_HOST" \
         FLASHDREAMS_TURN_PORT="$TURN_PORT" \
         FLASHDREAMS_TURN_USERNAME="$TURN_USERNAME" \
         FLASHDREAMS_TURN_CREDENTIAL="$TURN_SECRET"
fi

# The application slug for a MODEL value (14b or 5b).
app_slug() {
  case "$1" in
    14b) echo game2v-eden-world-v2-14b-taehv ;;
    5b)  echo game2v-eden-world-v2-5b-taehv ;;
    *)   echo "unknown model '$1' (use 14b or 5b)" >&2; return 1 ;;
  esac
}
