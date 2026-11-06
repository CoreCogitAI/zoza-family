#!/usr/bin/env bash
# Runs the server and, when TUNNEL_TOKEN is set, the Cloudflare tunnel for
# eth.zoza.world. If either stops, the machine exits and Fly restarts it.
set -u
mkdir -p /app/server/data
# A data file copied in while the server ran waits as state.json.new.
if [ -f /app/server/data/state.json.new ]; then mv /app/server/data/state.json.new /app/server/data/state.json; fi
(cd /app/server && exec node index.mjs) &
if [ -n "${TUNNEL_TOKEN:-}" ]; then
  cloudflared tunnel --no-autoupdate --config /app/deploy/cloudflared.yml run --token "$TUNNEL_TOKEN" &
fi
wait -n
exit 1
