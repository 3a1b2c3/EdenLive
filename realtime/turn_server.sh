#!/usr/bin/env bash
# TURN relay for the Game2V WebRTC page.
#
# A browser on another subnet usually has no direct UDP path to the server:
# without a relay its peer connection stalls in "connecting". The page already
# reaches the server over TCP, so a relay listening here on TCP gives the media
# a route.
#
# --no-tls/--no-dtls: no certificate is provisioned; the media is already
# DTLS-encrypted end to end by WebRTC itself.
#
# Usage: bash turn_server.sh [relay-ip]
#
# Reads TURN_SECRET, TURN_PORT, TURN_USERNAME and TURN_IFACE from deploy.conf.
# The relay address defaults to TURN_IFACE's. Whatever it ends up being has to
# match TURN_HOST, which is what the app hands the browser.
#
# Needs coturn (`turnserver`) on PATH.
set -u
. "$(dirname "$(readlink -f "$0")")/_common.sh"

if [ -z "${TURN_SECRET:-}" ]; then
  echo "set TURN_SECRET in deploy.conf to the credential the relay requires" >&2
  exit 1
fi
IP="${1:-}"
if [ -z "$IP" ]; then
  IP="$(ip -4 -o addr show "${TURN_IFACE:-eth0}" 2>/dev/null | awk '{print $4}' | cut -d/ -f1)"
fi
if [ -z "$IP" ]; then
  echo "no IPv4 address on ${TURN_IFACE:-eth0}; pass the relay IP, or set" \
       "TURN_IFACE in deploy.conf" >&2
  exit 1
fi
pkill -f '[t]urnserver' 2>/dev/null || true
nohup turnserver -n --listening-port="${TURN_PORT:-3478}" \
  --listening-ip="$IP" --relay-ip="$IP" --external-ip="$IP" \
  --realm=flashdreams --lt-cred-mech \
  --user="${TURN_USERNAME:-flashdreams}:${TURN_SECRET}" \
  --no-tls --no-dtls --no-cli \
  --min-port=49160 --max-port=49200 --log-file=stdout --simple-log \
  > .turnserver.log 2>&1 < /dev/null &
sleep 2
echo "turn relay on ${IP}:${TURN_PORT:-3478} (log .turnserver.log)"
echo "set TURN_HOST=${IP} in deploy.conf so the app hands the browser this relay"
pgrep -af '[t]urnserver' | head -2
