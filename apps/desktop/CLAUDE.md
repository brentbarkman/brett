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

### Preload / IPC

`electron/preload.ts` uses `contextBridge.exposeInMainWorld` to expose `electronAPI` to the renderer. All new IPC should go through this bridge — never enable `nodeIntegration`.

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
