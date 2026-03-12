#!/usr/bin/env bash
set -euo pipefail

# Check if Postgres is accepting connections
pg_ready() {
  if command -v pg_isready &> /dev/null; then
    pg_isready -h localhost -p 5432 > /dev/null 2>&1
  elif command -v docker &> /dev/null; then
    docker compose exec -T postgres pg_isready -U brett -d brett_dev > /dev/null 2>&1
  else
    # Last resort: try connecting with node
    node -e "const net=require('net');const s=net.connect(5432,'localhost',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null
  fi
}

if pg_ready; then
  echo "Postgres is already running."
elif command -v docker &> /dev/null; then
  if ! docker compose ps --status running 2>/dev/null | grep -q postgres; then
    echo "Starting Postgres via Docker..."
    docker compose up -d
  fi
  echo "Waiting for Postgres to be ready..."
  until pg_ready; do sleep 0.5; done
  echo "Postgres is ready."
elif command -v brew &> /dev/null; then
  echo "Starting Postgres via Homebrew..."
  brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || {
    echo "Error: Could not start Postgres via Homebrew."
    exit 1
  }
  echo "Waiting for Postgres to be ready..."
  until pg_ready; do sleep 0.5; done
  echo "Postgres is ready."
else
  echo "Error: No Postgres found. Install one of:"
  echo "  - Docker Desktop: https://www.docker.com/products/docker-desktop/"
  echo "  - Homebrew: brew install postgresql@16"
  exit 1
fi

# Run pending migrations (safe to run if already up to date)
echo "Checking migrations..."
pnpm --filter @brett/api exec prisma migrate deploy 2>/dev/null || {
  echo "Running initial migration..."
  pnpm --filter @brett/api exec prisma migrate dev --name init
}

# Start API + desktop
echo "Starting API + desktop..."
exec turbo run dev --filter=@brett/desktop --filter=@brett/api
