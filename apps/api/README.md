# @brett/api

Hono API server with better-auth, Prisma, and S3-compatible object storage.

## Local Dev Setup

All commands run from the **monorepo root** unless noted otherwise.

### 1. Environment variables

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env`:

| Variable | Required | How to get it |
|----------|----------|---------------|
| `DATABASE_URL` | Yes (has default) | Default `postgresql://brett:brett_dev@localhost:5432/brett_dev` matches `docker-compose.yml` |
| `BETTER_AUTH_SECRET` | Yes | Run `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Yes (has default) | `http://localhost:3001` for local dev |
| `GOOGLE_CLIENT_ID` | No | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — create OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | No | Same as above |
| `STORAGE_*` | Yes (has default) | Defaults to local MinIO via `docker-compose.yml`. Required for file attachments. |
| `FCM_*` | No | Only needed for push notifications |

### 2. Start Postgres + run migrations

```bash
pnpm db:up         # starts Postgres 16 in Docker
pnpm db:migrate    # creates better-auth tables
# or: pnpm setup   # does both
```

### 3. Start developing

```bash
pnpm dev:full      # starts Postgres + migrations + API + desktop (one command)
# or just the API:
pnpm dev:api       # starts on http://localhost:3001 with hot reload (tsx watch)
```

Verify: `curl http://localhost:3001/health` should return `{"status":"ok"}`.

### Useful commands

```bash
pnpm db:studio               # Prisma Studio GUI at http://localhost:5555
pnpm db:migrate              # run after editing prisma/schema.prisma
pnpm test                    # run all API tests (Postgres must be running)
pnpm --filter @brett/api run test:watch   # vitest in watch mode
pnpm typecheck               # type-check all packages
```

## Stack

- **Framework:** [Hono](https://hono.dev) (lightweight, Web Standards-based)
- **Auth:** [better-auth](https://www.better-auth.com) (email/password + Google OAuth, JWT bearer tokens)
- **Database:** [Prisma](https://www.prisma.io) + PostgreSQL
- **Storage:** AWS SDK S3 client (MinIO locally, Railway Object Storage in prod)
- **Tests:** [Vitest](https://vitest.dev)

## Project Structure

```
apps/api/
├── prisma/
│   └── schema.prisma         # Database schema (better-auth tables)
├── src/
│   ├── index.ts              # Server entrypoint (starts Hono on PORT)
│   ├── app.ts                # Hono app setup (routes, CORS, middleware)
│   ├── lib/
│   │   ├── auth.ts           # better-auth server config
│   │   ├── prisma.ts         # Prisma client singleton
│   │   └── storage.ts        # S3 client for Railway object storage
│   ├── middleware/
│   │   └── auth.ts           # Session verification middleware
│   ├── routes/
│   │   ├── auth.ts           # Mounts better-auth at /api/auth/*
│   │   ├── users.ts          # GET /users/me
│   │   ├── things.ts         # CRUD for items/tasks
│   │   ├── lists.ts          # CRUD for lists
│   │   ├── attachments.ts    # File upload/delete (S3)
│   │   ├── links.ts          # Item link CRUD
│   │   └── brett.ts          # Brett AI messages + brett-take
│   └── __tests__/
│       ├── setup.ts          # Test env vars
│       ├── health.test.ts    # Health check (no DB required)
│       ├── auth.test.ts      # Auth flow tests (requires Postgres)
│       ├── things.test.ts    # Things CRUD tests
│       ├── lists.test.ts     # Lists CRUD tests
│       ├── attachments.test.ts # Attachment upload/delete tests
│       ├── links.test.ts     # Item link tests
│       ├── brett.test.ts     # Brett message tests
│       └── recurrence.test.ts # Recurring task tests
├── Dockerfile                # Multi-stage build for Railway
├── railway.json              # Railway deploy config
└── vitest.config.ts
```

## API Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check |
| * | `/api/auth/*` | — | better-auth endpoints (sign-up, sign-in, session, etc.) |
| GET | `/users/me` | Yes | Current authenticated user |

better-auth automatically handles these sub-routes under `/api/auth/`:
- `POST /api/auth/sign-up/email` — create account (returns `{ user, token }`)
- `POST /api/auth/sign-in/email` — email/password sign-in (returns `{ user, session, token }`)
- `POST /api/auth/sign-in/social` — Google OAuth
- `GET /api/auth/session` — get current session
- `POST /api/auth/sign-out` — sign out

The `bearer` plugin is enabled — clients authenticate via `Authorization: Bearer <token>` header instead of cookies. Sign-in and sign-up responses include a `token` field.

## Database

Prisma schema uses better-auth's required tables: `User`, `Session`, `Account`, `Verification`.

```bash
pnpm db:migrate    # Create/run migrations
pnpm db:studio     # Open Prisma Studio GUI
```

## Tests

```bash
pnpm test                    # Run all tests (requires Postgres)
pnpm test:watch              # Watch mode
vitest run health.test.ts    # Health check only (no DB needed)
```

## Deployment

Deploys to Railway via `Dockerfile`. The `railway.json` start command runs `prisma migrate deploy` before starting the server.

Required Railway env vars:
- `DATABASE_URL` — auto-linked from Railway Postgres plugin
- `BETTER_AUTH_SECRET` — session signing secret
- `BETTER_AUTH_URL` — Railway-provided public URL
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — for Google OAuth
- `STORAGE_*` — Railway object storage credentials
