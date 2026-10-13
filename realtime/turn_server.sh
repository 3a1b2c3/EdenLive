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

[ -n "$TURN_SECRET" ] || die "set TURN_SECRET in deploy.local.conf"
command -v turnserver >/dev/null || die "turnserver not found; install coturn"

IP="${1:-$(ip -4 -o addr show "$TURN_IFACE" 2>/dev/null | awk '{print $4}' | cut -d/ -f1)}"
[ -n "$IP" ] || die "no IPv4 address on $TURN_IFACE; pass the relay IP or set TURN_IFACE"

serve turn .turnserver.log \
  turnserver -n --listening-port="$TURN_PORT" \
  --listening-ip="$IP" --relay-ip="$IP" --external-ip="$IP" \
  --realm=flashdreams --lt-cred-mech --user="$TURN_USERNAME:$TURN_SECRET" \
  --no-tls --no-dtls --no-cli --min-port=49160 --max-port=49200 \
  --log-file=stdout --simple-log

sleep 2
running turn || die "TURN relay exited; see .turnserver.log"
echo "TURN relay on $IP:$TURN_PORT"
echo "set TURN_HOST=$IP"
