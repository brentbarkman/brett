# Brett

Personal productivity app — desktop-first, with a mobile companion planned.

## Prerequisites

- **Node.js 20+** (`.nvmrc` included — run `nvm use`)
- **pnpm 8.15.6** (`corepack enable && corepack prepare pnpm@8.15.6 --activate`)
- **Postgres** — either [Docker Desktop](https://www.docker.com/products/docker-desktop/) or `brew install postgresql@16`

## Local Dev Setup

### First-time setup

```bash
nvm use                                    # switches to Node 20 (reads .nvmrc)
pnpm install                               # install dependencies
cp apps/api/.env.example apps/api/.env     # create API env file
cp apps/desktop/.env.example apps/desktop/.env  # create desktop env file
```

The `.env.example` files include working defaults for local dev — no manual editing needed.

**If using Homebrew Postgres** (instead of Docker), also create the database and update the URL:
```bash
createdb brett_dev
# Then in apps/api/.env, set:
# DATABASE_URL=postgresql://localhost:5432/brett_dev
```

Everything else has working defaults. Google OAuth (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) is optional — get credentials from [Google Cloud Console](https://console.cloud.google.com/apis/credentials) if you want it.

### Day-to-day development

```bash
pnpm dev:full
```

That's it. This single command:
1. Starts Postgres if not already running (auto-detects Docker or Homebrew)
2. Waits for it to be ready
3. Applies any pending database migrations
4. Starts the API server on `http://localhost:3001`
5. Starts the desktop Vite dev server on `http://localhost:5173`

Open `http://localhost:5173` to see the app.

### Running Electron (full desktop app)

`pnpm dev:full` runs the renderer in the browser. To test Electron-specific features (IPC, safeStorage, system tray):

```bash
# Terminal 1 (from root):
pnpm dev:api

# Terminal 2 (from apps/desktop):
pnpm electron:dev
```

### Other commands

```bash
pnpm dev:api             # API only
pnpm dev:desktop         # Desktop Vite only
pnpm typecheck           # type-check all packages
pnpm test                # run API tests (Postgres must be running)
pnpm db:studio           # browse database in Prisma Studio
pnpm db:migrate          # run after editing prisma/schema.prisma
pnpm db:down             # stop Postgres when done
```

## Working in a Git Worktree

Each git worktree needs its own setup since `node_modules` aren't shared (due to `node-linker=hoisted`). The Postgres Docker container _is_ shared across worktrees.

```bash
cd <your-worktree-directory>
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/desktop/.env.example apps/desktop/.env
pnpm dev:full
```

> **Note:** If Postgres is already running from another worktree, `dev:full` detects it and skips startup. Migrations are idempotent.

If you're running multiple worktrees simultaneously, change the ports in the second worktree's `.env` files to avoid conflicts:
- `apps/api/.env` → `PORT=3002`
- `apps/desktop/.env` → `VITE_API_URL=http://localhost:3002`

## Project Structure

```
brett/
├── apps/
│   ├── api/            # Hono API server (better-auth, Prisma, S3 storage)
│   ├── desktop/        # Electron + Vite + React
│   └── mobile/         # Expo / React Native (deferred)
├── packages/
│   ├── types/          # Shared TypeScript interfaces
│   ├── utils/          # Generic helpers (formatDate, generateId, sleep)
│   ├── business/       # Domain logic (createTask, toggleTask)
│   └── ui/             # Web-only React components (desktop only)
├── docker-compose.yml  # Local Postgres 16 (if using Docker)
└── turbo.json          # Turborepo task config
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run all apps in parallel |
| `pnpm dev:full` | Start everything (Postgres + migrations + API + desktop) |
| `pnpm dev:api` | API server only |
| `pnpm dev:desktop` | Desktop only |
| `pnpm build` | Build all packages and apps |
| `pnpm typecheck` | Type-check all packages |
| `pnpm test` | Run API tests (requires Postgres) |
| `pnpm db:up` | Start local Postgres via Docker |
| `pnpm db:down` | Stop local Postgres |
| `pnpm db:migrate` | Run Prisma migrations |
| `pnpm db:studio` | Open Prisma Studio (DB GUI) |
| `pnpm setup` | Start Postgres + run migrations |

## Architecture

pnpm workspaces + Turborepo monorepo. All workspace deps use `workspace:*`.

```
@brett/types
  ↑
@brett/utils
  ↑
@brett/business
  ↑
@brett/api        ← Hono + Prisma + better-auth
@brett/desktop    ← Electron + Vite + React (imports all packages)
@brett/mobile     ← Expo (imports types, utils, business — NOT ui)

@brett/ui         ← web-only React components (desktop only)
```

### Auth

**better-auth** handles authentication (email/password + Google OAuth). The server runs inside `apps/api/` with the `bearer` plugin, the client SDK runs in the desktop renderer. Auth uses JWT bearer tokens (not cookies) — the desktop client stores tokens securely via Electron's `safeStorage` API and sends them as `Authorization: Bearer <token>` headers.

### Database

**Prisma** with PostgreSQL. Docker Compose for local dev, Railway's managed Postgres in prod.

### Object Storage

**Railway Object Storage** (S3-compatible). Client configured in `apps/api/src/lib/storage.ts`.

### Notifications (planned)

**Firebase Cloud Messaging** — for push notifications only. Not used for auth.

## Environment Variables

See `.env.example` files in `apps/api/` and `apps/desktop/`.

Key variables:
- `DATABASE_URL` — Postgres connection string (defaults to Docker Compose values)
- `BETTER_AUTH_SECRET` — Session signing secret (generate with `openssl rand -base64 32`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth (optional for dev)
- `STORAGE_*` — Railway S3-compatible object storage (optional for dev)

## Deployment

The API deploys to **Railway** via Dockerfile (`apps/api/Dockerfile`). See `apps/api/railway.json` for deploy config. Prisma migrations run automatically on deploy.
