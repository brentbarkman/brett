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

### Preload / IPC

`electron/preload.ts` uses `contextBridge.exposeInMainWorld` to expose `electronAPI` to the renderer. All new IPC should go through this bridge — never enable `nodeIntegration`.

Available IPC methods:
- `platform` — current OS platform
- `storeToken(token)` — encrypt and persist a token via `safeStorage` + `electron-store`
- `getToken()` — decrypt and return stored token
- `clearToken()` — remove stored token

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
- Build output: `dist/renderer/`
- `src/vite-env.d.ts` provides Vite's `ImportMeta` types (required for `import.meta.env`)
