#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Dev on iOS Simulator — one command
#
# Usage: ./scripts/dev-simulator.sh
#
# Starts: Postgres, API server, Expo (iOS Simulator)
# No ngrok needed — simulator uses localhost
# ─────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/../.." && pwd)"

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# 1. Start Postgres + MinIO
echo "▸ Starting database..."
(cd "$REPO_ROOT" && docker compose up -d 2>/dev/null) || true
sleep 1

# 2. Build shared packages
echo "▸ Building shared packages..."
(cd "$REPO_ROOT" && pnpm build --filter @brett/types --filter @brett/utils --filter @brett/business 2>/dev/null) || true

# 3. Start API server in background
echo "▸ Starting API server..."
(cd "$REPO_ROOT/apps/api" && npx tsx watch --env-file=.env src/index.ts) &
API_PID=$!

# Wait for API
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

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  API: http://localhost:3001"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 4. Start Expo
echo "▸ Starting Expo (iOS Simulator)..."
cd "$MOBILE_DIR"
EXPO_PUBLIC_API_URL=http://localhost:3001 npx expo run:ios
