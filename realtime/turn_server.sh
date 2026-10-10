#!/usr/bin/env bash
# Start the TURN relay for the WebRTC page, on the GPU host.
#
# Usage: bash turn_server.sh [relay-ip]
#
# A browser on another subnet usually has no direct UDP path to the server; the
# relay gives the media a TCP route. The relay IP defaults to TURN_IFACE's
# address and must match TURN_HOST. Needs coturn (`apt-get install coturn`).
#
# No TLS/DTLS on the relay itself: WebRTC already encrypts the media end to end.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"

if [ -z "$TURN_SECRET" ]; then
  echo "set TURN_SECRET in deploy.local.conf" >&2
  exit 1
fi
if ! command -v turnserver >/dev/null; then
  echo "turnserver not found; install coturn" >&2
  exit 1
fi
IP="${1:-$(ip -4 -o addr show "$TURN_IFACE" 2>/dev/null | awk '{print $4}' | cut -d/ -f1)}"
if [ -z "$IP" ]; then
  echo "no IPv4 address on $TURN_IFACE; pass the relay IP or set TURN_IFACE" >&2
  exit 1
fi

pkill -f '[t]urnserver' 2>/dev/null || true
nohup turnserver -n --listening-port="$TURN_PORT" \
  --listening-ip="$IP" --relay-ip="$IP" --external-ip="$IP" \
  --realm=flashdreams --lt-cred-mech --user="$TURN_USERNAME:$TURN_SECRET" \
  --no-tls --no-dtls --no-cli --min-port=49160 --max-port=49200 \
  --log-file=stdout --simple-log \
  > .turnserver.log 2>&1 < /dev/null &
sleep 2
if ! kill -0 $! 2>/dev/null; then
  echo "TURN relay exited; see .turnserver.log" >&2
  exit 1
fi
echo "TURN relay on $IP:$TURN_PORT (log .turnserver.log)"
echo "set TURN_HOST=$IP"
