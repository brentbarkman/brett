# @brett/desktop

Electron + Vite + React desktop app with better-auth authentication.

## Local Dev Setup

All commands run from the **monorepo root** unless noted otherwise.

### Prerequisites

Complete the [first-time setup](../../README.md#first-time-setup) in the root README if you haven't already.

### Easiest way to start

From the monorepo root:

```bash
pnpm dev:full    # starts Postgres + migrations + API + desktop Vite (one command)
```

Open `http://localhost:5173` in a browser.

### Other ways to run

```bash
# Renderer only (no API — auth won't work)
pnpm dev:desktop

# Full Electron app (for testing IPC, safeStorage, system tray)
# Terminal 1 (from root):
pnpm dev:api
# Terminal 2 (from apps/desktop):
pnpm electron:dev
```

## Stack

- **Runtime:** [Electron](https://www.electronjs.org) 28
- **Bundler:** [Vite](https://vitejs.dev) 5
- **UI:** React 18 + [Tailwind CSS](https://tailwindcss.com) + shadcn/ui components
- **Auth:** [better-auth](https://www.better-auth.com) React client (JWT bearer tokens)

## Project Structure

```
apps/desktop/
├── electron/
│   ├── main.ts               # Electron main process + IPC handlers
│   └── preload.ts            # Context bridge (electronAPI)
├── src/
│   ├── main.tsx              # React entry (AuthProvider → AuthGuard → App)
│   ├── App.tsx               # Dashboard layout
│   ├── auth/
│   │   ├── auth-client.ts    # better-auth client instance
│   │   ├── AuthContext.tsx    # React auth context + hooks
│   │   ├── AuthGuard.tsx     # Auth gate component
│   │   └── LoginPage.tsx     # Sign-in / sign-up UI
│   ├── data/
│   │   └── mockData.ts       # Mock dashboard data
│   └── vite-env.d.ts         # Vite ImportMeta types
├── index.html                # Vite entry
├── vite.config.ts
├── tsconfig.json             # Renderer (React, DOM)
├── tsconfig.electron.json    # Main process (CommonJS, Node)
├── tailwind.config.js
└── postcss.config.js
```

## Auth Flow

1. User lands on `LoginPage` (email/password form + Google OAuth button)
2. better-auth client calls the API server (`VITE_API_URL/api/auth/*`)
3. API returns a JWT bearer token in the response
4. `auth-client.ts` captures the token and stores it securely via Electron's `safeStorage` IPC
5. All subsequent API requests include the token as `Authorization: Bearer <token>`
6. On app restart, the token is loaded from secure storage — the user stays signed in
7. `AuthGuard` checks session state and renders the dashboard or login page

## Electron IPC

The preload script exposes `window.electronAPI`:

| Method | Description |
|--------|-------------|
| `platform` | Current OS (`darwin`, `win32`, `linux`) |
| `storeToken(token)` | Encrypt + persist token via `safeStorage` |
| `getToken()` | Decrypt + return stored token |
| `clearToken()` | Remove stored token |

Token storage uses Electron's `safeStorage` API for encryption and `electron-store` for persistence.
