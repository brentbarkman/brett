# CLAUDE.md — Mobile App

## Quick Start

### Simulator (simplest)
```bash
./scripts/dev-simulator.sh
```
Starts Postgres, API, and the iOS Simulator. No Apple Developer account needed.

### Physical Device
```bash
./scripts/dev-device.sh
```
Starts Postgres, API, ngrok tunnel, and builds to your connected iPhone.

**Requirements:**
- Docker (for Postgres)
- Xcode (with iOS Simulator or a connected device)
- ngrok (`brew install ngrok`, free tier works) — only for physical device
- Apple Developer account configured in Xcode (free works for Simulator, paid for device features like push notifications)
- Phone in Developer Mode: Settings > Privacy & Security > Developer Mode

### Manual Setup (if scripts don't work)

1. Start Postgres: `cd ../.. && docker compose up -d`
2. Build shared packages: `cd ../.. && pnpm build --filter @brett/types --filter @brett/utils --filter @brett/business`
3. Start API: `cd ../api && npx tsx watch --env-file=.env src/index.ts`
4. Start Expo:
   - Simulator: `EXPO_PUBLIC_API_URL=http://localhost:3001 npx expo run:ios`
   - Device: `EXPO_PUBLIC_API_URL=https://YOUR-NGROK-URL npx expo run:ios --device`

### Test Account

Sign up from the sign-in screen or use the desktop app to create an account first. Both apps share the same local Postgres database.

## Architecture

See `docs/superpowers/specs/2026-04-07-ios-app-system-design.md` for the full system design.

### Key Directories
```
app/                 # Expo Router screens (file-based routing)
  (auth)/            # Sign-in flow (unauthenticated)
  (app)/             # Authenticated screens
src/
  api/               # HTTP client, SSE client
  auth/              # Token storage, auth provider
  db/                # SQLite database, Drizzle schema
  hooks/             # React hooks (useItems, useLists, useSync)
  notifications/     # Push notification registration
  store/             # Zustand stores (items, lists, sync health)
  sync/              # Sync engine (mutation queue, push/pull, conflict resolver)
```

### Data Flow
```
User action → Zustand store → SQLite (optimistic) → mutation queue → /sync/push → server
Server change → /sync/pull → SQLite → Zustand store → React re-render
```

### Offline-First
Every write is persisted to SQLite immediately (optimistic). The sync engine pushes mutations to the server when online. If offline, mutations queue up and sync when connectivity returns. Pull-to-refresh and a 30-second auto-poll keep data fresh.

## Dev Notes

- **Hot reload works** for JS changes. Only rebuild (`npx expo run:ios`) when changing `app.config.ts` or adding/removing native modules.
- **Shared packages** (`@brett/types`, `@brett/utils`, `@brett/business`) must be built before the API can start. The dev scripts handle this.
- **Metro config** includes a custom resolver that maps `.js` imports to `.ts` files (ESM monorepo compatibility).
- **App Transport Security** is disabled in dev (`NSAllowsArbitraryLoads`) to allow HTTP. This must be tightened for production.
