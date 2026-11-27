#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mode="${1:-demo}"
if [[ "$mode" != demo && "$mode" != live && "$mode" != showcase ]]; then
  echo "Usage: npm run capture -- [demo|live|showcase]" >&2
  exit 2
fi
mkdir -p .local artifacts
work="$(mktemp -d .local/capture.XXXXXX)"
api_port="${CAPTURE_API_PORT:-8877}"
sim_port="${CAPTURE_SIM_PORT:-9899}"
api_url="http://127.0.0.1:$api_port"
sim_url="http://127.0.0.1:$sim_port"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill -- "-$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  pids=()
}
trap cleanup EXIT
trap 'exit 130' INT TERM

npm run build
seed=0
[[ "$mode" != demo ]] || seed=1
setsid env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u STT_URL -u POCKETPULSE_ORIGIN \
  HOST=127.0.0.1 PORT="$api_port" DEMO_MODE="$seed" POCKETPULSE_DATA="$work" \
  node server/http.js >"$work/api.log" 2>&1 &
pids+=("$!")
ready() {
  local url="$1" pid="$2" logfile="$3"
  for ((i=0; i<100; i++)); do
    kill -0 "$pid" 2>/dev/null || break
    if curl -fsS --max-time 1 "$url" >/dev/null 2>&1; then return; fi
    sleep .15
  done
  tail -80 "$logfile" >&2
  return 1
}
ready "$api_url/api/health" "${pids[0]}" "$work/api.log"
setsid xvfb-run -a -s '-screen 0 1280x900x24' env GDK_BACKEND=x11 \
  node_modules/.bin/evenhub-simulator "$api_url" --automation-port "$sim_port" \
  --config "$work/sim.toml" --no-glow >"$work/simulator.log" 2>&1 &
pids+=("$!")
ready "$sim_url/api/ping" "${pids[1]}" "$work/simulator.log"
if ! node scripts/capture.js "$sim_url" "$api_url" "$mode" "$work"; then
  tail -50 "$work/simulator.log" >&2
  tail -50 "$work/api.log" >&2
  exit 1
fi
cleanup
echo "Capture logs and SQLite evidence: $work"
if [[ "$mode" == showcase ]]; then
  "${SHOWCASE_PYTHON:-python3}" scripts/showcase.py "$work"
fi
