#!/usr/bin/env bash
# Zoza Family on Ethereum Sepolia, run from this machine.
#   ./run.sh            build the website and start the server on http://127.0.0.1:8790
#   ./run.sh --stop     stop the server
#   ./run.sh test       contract tests against a Sepolia fork (real Calibur, Compound, USDC)
#   ./run.sh e2e        the live end-to-end checks against the running server
#   ./run.sh fund 0.001 buy test USDC for the faucet with Sepolia ETH, via the Uniswap API
#   ./run.sh deploy     deploy the contracts (writes deployments/11155111.json)
# Keys come from .env (git ignores it): DEPLOYER_KEY, RELAYER_KEY, KEEPER_KEY,
# UNISWAP_API_KEY, NOTIFY_TOKEN, and WATCHER=cre for the default automation path.
# Use WATCHER=server only as a local fallback. Use fresh wallets that
# only ever hold test money.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/opt/node@24/bin:$HOME/.foundry/bin:$PATH"
PORT=${PORT:-8790}
PID=.server.pid
stop() { [[ -f $PID ]] && kill "$(cat $PID)" 2>/dev/null || true; rm -f $PID; }

case "${1:-start}" in
start)
  [[ -f .env ]] || { echo "Missing .env (see .env.example)"; exit 1; }
  stop
  [[ -d node_modules ]] || npm install --silent
  [[ -d server/node_modules ]] || (cd server && npm install --silent)
  [[ -d web/node_modules ]] || (cd web && npm install --silent)
  (cd web && npx vite build --logLevel warn)
  (cd server && PORT=$PORT exec node --env-file=../.env index.mjs) > .server.log 2>&1 &
  echo $! > $PID
  for _ in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/api/config" >/dev/null && break; sleep 0.3; done
  curl -sf "http://127.0.0.1:$PORT/api/config" >/dev/null || { cat .server.log; exit 1; }
  echo "Open http://127.0.0.1:$PORT   Logs: .server.log   Stop: ./run.sh --stop"
  ;;
--stop) stop; echo stopped ;;
test) forge test ;;
e2e) (cd server && API_URL="http://127.0.0.1:$PORT" node --env-file=../.env e2e.mjs) ;;
fund) (cd server && node --env-file=../.env fund.mjs "${2:-0.001}") ;;
deploy)
  set -a; source .env; set +a
  COMET=${COMET:-0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e} FORWARDER=${FORWARDER:-0x15fC6ae953E024d975e77382eEeC56A9101f9F88} \
    forge script script/Deploy.s.sol --rpc-url "${RPC_URL:-https://sepolia.gateway.tenderly.co}" --private-key "$DEPLOYER_KEY" \
    --broadcast --slow --skip-simulation --with-gas-price 50000000 --priority-gas-price 20000000
  node script/abi.mjs
  ;;
*) echo "usage: ./run.sh [start|--stop|test|e2e|fund|deploy]"; exit 1 ;;
esac
