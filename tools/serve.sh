#!/usr/bin/env bash
# Starts everything the browser client needs, and stops it all together on Ctrl-C.
#
#   npm run serve
#
# Three processes:
#   asset server  :8766  reads the WoW client's MPQ chain
#   bridge        :8765  relays WebSocket frames to the server's TCP ports
#   vite          :5173  serves the client, and proxies the other two so the browser
#                        only ever talks to one origin
#
# Only 5173 needs to be reachable from another device.
set -euo pipefail

cd "$(dirname "$0")/.."

# nvm-installed node is not on PATH in a non-interactive shell.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

WOW_CLIENT="${WOW_CLIENT:-$(cd .. && pwd)/wow-335a}"
WOW_LOCALE="${WOW_LOCALE:-enUS}"

if [ ! -f "$WOW_CLIENT/Data/patch-3.MPQ" ]; then
  echo "No 3.3.5a client at $WOW_CLIENT (set WOW_CLIENT to point at it)." >&2
  exit 1
fi

pids=()
cleanup() {
  trap - INT TERM EXIT
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "client:  $WOW_CLIENT ($WOW_LOCALE)"

npx tsx tools/asset-server/index.ts --client "$WOW_CLIENT" --locale "$WOW_LOCALE" &
pids+=($!)

npx tsx tools/bridge/index.ts &
pids+=($!)

npx vite &
pids+=($!)

# Report every address the client can be opened at, so a phone or laptop on the same
# tailnet can just be handed a URL.
sleep 4
echo
echo "open the client at:"
echo "  http://localhost:5173"
if command -v tailscale >/dev/null 2>&1; then
  ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
  name="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName":"\([^"]*\)\..*/\1/p' | head -1 || true)"
  [ -n "$ip" ] && echo "  http://$ip:5173"
  [ -n "$name" ] && echo "  http://$name:5173"
fi
echo
echo "Ctrl-C stops all three."

wait
