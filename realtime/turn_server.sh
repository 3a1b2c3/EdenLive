#!/usr/bin/env bash
# Local TURN relay for the Game2V WebRTC page, run on the GPU pod itself.
#
# The relay start.sh pointed at (localhost:3478) no longer exists, and a
# browser outside the pod's subnet has no direct UDP path to it: without a
# relay its peer connection stalls in "connecting". The page already reaches
# the pod over TCP, so a relay listening here on TCP gives the media a route.
#
# --no-tls/--no-dtls: no certificate is provisioned; the media is already
# DTLS-encrypted end to end by WebRTC itself.
# Usage: bash turn_server.sh [relay-ip]   (default: the pod's net0 address)
IP="${1:-$(ip -4 -o addr show net0 | awk '{print $4}' | cut -d/ -f1)}"
pkill -f '[t]urnserver' 2>/dev/null || true
nohup turnserver -n --listening-port=3478 --listening-ip="$IP" --relay-ip="$IP" \
  --external-ip="$IP" --realm=flashdreams --lt-cred-mech \
  --user=flashdreams:turnsecret --no-tls --no-dtls --no-cli \
  --min-port=49160 --max-port=49200 --log-file=stdout --simple-log \
  > /tmp/turnserver.log 2>&1 < /dev/null &
sleep 2
pgrep -af '[t]urnserver' | head -2
ss -lntup 2>/dev/null | grep 3478
