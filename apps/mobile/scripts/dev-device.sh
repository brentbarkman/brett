#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Dev on physical device — one command, handles everything
#
# Usage: ./scripts/dev-device.sh
#
# Starts: Postgres, API server, ngrok tunnel, Expo dev client
# Requires: Docker, ngrok (free tier works), Xcode
# ─────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/../.." && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$NGROK_PID" ] && kill "$NGROK_PID" 2>/dev/null
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# 1. Start Postgres + MinIO (if not already running)
echo "▸ Starting database..."
(cd "$REPO_ROOT" && docker compose up -d 2>/dev/null) || true
sleep 1

# 2. Build shared packages (in case they're stale)
echo "▸ Building shared packages..."
(cd "$REPO_ROOT" && pnpm build --filter @brett/types --filter @brett/utils --filter @brett/business 2>/dev/null) || true

# 3. Start API server in background
echo "▸ Starting API server..."
(cd "$REPO_ROOT/apps/api" && npx tsx watch --env-file=.env src/index.ts) &
API_PID=$!

# Wait for API to be ready
echo -n "  Waiting for API"
for i in $(seq 1 30); do
  if curl -s http://localhost:3001/health >/dev/null 2>&1; then
    echo " ✓"
    break
  fi
  echo -n "."
  sleep 1
done

if ! curl -s http://localhost:3001/health >/dev/null 2>&1; then
  echo " ✗ API failed to start"
  exit 1
fi

# 4. Start ngrok tunnel in background
echo "▸ Starting ngrok tunnel..."
# Kill any leftover ngrok from a previous run (port 4040 conflict)
pkill -9 -f "ngrok" 2>/dev/null || true
lsof -ti:4040 | xargs kill -9 2>/dev/null || true
sleep 2
ngrok http 3001 --log=stdout --log-format=json >/tmp/ngrok.log 2>&1 &
NGROK_PID=$!

# Wait for ngrok to establish tunnel
echo -n "  Waiting for tunnel"
NGROK_URL=""
for i in $(seq 1 30); do
  NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | python3 -c "import sys,json; t=json.load(sys.stdin)['tunnels']; print(next(x['public_url'] for x in t if x['public_url'].startswith('https')))" 2>/dev/null || true)
  if [ -n "$NGROK_URL" ]; then
    echo " ✓"
    break
  fi
  echo -n "."
  sleep 1
done

if [ -z "$NGROK_URL" ]; then
  echo " ✗ ngrok failed to start"
  echo "  Make sure ngrok is installed and authenticated: ngrok config add-authtoken <token>"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  API:    http://localhost:3001"
echo "  Tunnel: $NGROK_URL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 5. Start Expo with the ngrok URL
echo "▸ Starting Expo..."
echo "  The app will build and install on your connected device."
echo "  First build takes a few minutes. Subsequent runs are fast."
echo ""

cd "$MOBILE_DIR"
EXPO_PUBLIC_API_URL="$NGROK_URL" npx expo run:ios --device

# Cleanup happens via trap
