# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this directory.

## Build & Dev Commands

```bash
pnpm dev              # Vite dev server at localhost:5173
pnpm build            # tsc + vite build + electron tsc
pnpm typecheck        # Type-check both renderer and electron process
pnpm electron:dev     # Full Electron dev (Vite + tsc watch + electron concurrently)
pnpm electron:build   # Production build with electron-builder
```

## Architecture

Two TypeScript compilation targets in one app:

- **Renderer** (`src/`): React app bundled by Vite. Entry is `src/main.tsx`. tsconfig uses `react-jsx`, DOM libs, and `moduleResolution: "bundler"`. Output: `dist/renderer/`.
- **Main process** (`electron/`): Electron main + preload scripts. Separate `tsconfig.electron.json` using CommonJS + node moduleResolution. Output: `dist/electron/`.

The `index.html` at project root is the Vite entry point. Dev mode loads `localhost:5173`; production loads `dist/renderer/index.html`.

### Auth

Authentication uses **better-auth** client SDK (`better-auth/react`) with JWT bearer tokens.

- `src/auth/auth-client.ts` — better-auth client instance. Configures `fetchOptions.auth` to send bearer tokens on every request. Captures tokens from sign-in/sign-up responses and persists them via Electron's `safeStorage` IPC. Loads stored token on startup for auto-sign-in.
- `src/auth/AuthContext.tsx` — React context wrapping better-auth's `useSession()` hook. Exposes `user`, `loading`, `signInWithEmail`, `signUpWithEmail`, `signInWithGoogle`, `signOut`. Calls `clearStoredToken()` on sign-out.
- `src/auth/AuthGuard.tsx` — renders `<LoginPage />` or children based on auth state
- `src/auth/LoginPage.tsx` — Google OAuth button + email/password form (with name field on sign-up)

Auth uses JWT bearer tokens (not cookies) because Electron doesn't reliably handle cross-origin cookies, and JWTs work identically for future mobile support.

Entry point (`src/main.tsx`) wraps the app:
```tsx
<AuthProvider>
  <AuthGuard fallback={<LoginPage />}>
    <App />
  </AuthGuard>
</AuthProvider>
```

### Google OAuth (Desktop)

Google OAuth opens the system browser (not Electron's webview) so passkeys and biometrics work. The flow:

1. Renderer calls `startGoogleOAuth()` → IPC to main process
2. Main process spins up an ephemeral HTTP server on `127.0.0.1:<random-port>` and generates a `state` nonce
3. Opens system browser to `API_URL/api/auth/desktop/google?port=<port>&state=<state>`
4. API serves an HTML page that POSTs to better-auth's `/sign-in/social` (preserving cookies)
5. Google OAuth completes → better-auth callback → API's `/desktop-callback`
6. `/desktop-callback` verifies HMAC signature, reads session cookie, redirects to `http://127.0.0.1:<port>/callback?token=<session_token>&state=<state>`
7. Localhost server verifies state, stores token via `safeStorage`, resolves the IPC promise
8. Renderer calls `refetch()` to reload the session

### Preload / IPC

`electron/preload.ts` uses `contextBridge.exposeInMainWorld` to expose `electronAPI` to the renderer. All new IPC should go through this bridge — never enable `nodeIntegration`.

Available IPC methods:
- `platform` — current OS platform
- `storeToken(token)` — encrypt and persist a token via `safeStorage` + `electron-store`
- `getToken()` — decrypt and return stored token
- `clearToken()` — remove stored token
- `startGoogleOAuth()` — initiate Google OAuth via system browser with localhost callback

### Shared Package Imports

This app imports all four workspace packages:
```typescript
import { Button } from "@brett/ui";
import { createTask } from "@brett/business";
import { formatDate } from "@brett/utils";
import type { Task } from "@brett/types";
```

Vite resolves these directly to source (`main: "./src/index.ts"` in each package.json) — no pre-build step needed during dev.

### Vite Config

- `@vitejs/plugin-react` enabled
- Path alias: `@` → `./src`
- `base: "./"` — required for Electron; absolute paths (`/assets/...`) break under custom protocols
- Build output: `dist/renderer/`
- `src/vite-env.d.ts` provides Vite's `ImportMeta` types (required for `import.meta.env`)

### Environment Variables

- `VITE_API_URL` is split: `.env.development` (localhost) and `.env.production` (prod URL). Vite picks the right one by build mode.
- The Electron main process does NOT get Vite's `import.meta.env`. It reads API URL from `dist/electron/api-config.json` (generated at build time by `electron:build` script) or falls back to env vars.
- Never accept security-sensitive config from the renderer process via IPC.

### Production Build

```bash
pnpm electron:build          # Full build → .dmg in dist/
npx electron dist/electron/main.js   # Run built app without packaging (faster iteration)
```

### Electron Gotchas

- **`app://` protocol for production** — avoids insecure `file://` origin (which sends `null`). Registered with `protocol.registerSchemesAsPrivileged` before `app.whenReady()`.
- **Path traversal on custom protocols** — the `app://` handler must `path.resolve()` and verify the path is within the renderer directory.
- **`electron-builder` needs pinned electron version** — `^28.0.0` won't resolve, must be exact (e.g., `28.3.3`).
- **`electron-builder` needs `"build"` config in `package.json`** — `files`, `appId`, `productName` at minimum.
- **`safeStorage` fallback** — unencrypted token storage is only allowed in dev. Production must throw if encryption is unavailable.
- **DevTools** — only opened in development (`process.env.NODE_ENV === "development"`).
- **Concurrent OAuth** — only one OAuth flow at a time; reject if already in progress.
