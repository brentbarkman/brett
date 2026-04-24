FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.6 --activate

# Install deps for the full monorepo (needed for workspace resolution)
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
COPY packages/business/package.json packages/business/
COPY packages/api-core/package.json packages/api-core/
COPY packages/ai/package.json packages/ai/
COPY .npmrc ./
RUN pnpm install --frozen-lockfile --filter @brett/api...

# Build
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY packages/utils packages/utils
COPY packages/business packages/business
COPY packages/api-core packages/api-core
COPY packages/ai packages/ai
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
# Generate Prisma client — outputs to packages/api-core/src/generated/client
RUN pnpm --filter @brett/api exec prisma generate
# Build shared packages — API's tsc needs their .d.ts outputs
RUN pnpm --filter @brett/types run build && \
    pnpm --filter @brett/utils run build && \
    pnpm --filter @brett/business run build && \
    pnpm --filter @brett/api-core run build && \
    pnpm --filter @brett/ai run build
COPY apps/api apps/api
RUN pnpm --filter @brett/api run build

# Run
FROM base AS runner
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/types packages/types
COPY --from=build /app/packages/utils packages/utils
COPY --from=build /app/packages/business packages/business
COPY --from=build /app/packages/api-core packages/api-core
COPY --from=build /app/packages/ai packages/ai
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build /app/apps/api/package.json apps/api/package.json
WORKDIR /app/apps/api
# Container-level healthcheck — surfaces crashed-but-not-exited states to
# the orchestrator. Railway's own HTTP healthcheck complements this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sf "http://localhost:${PORT:-8080}/health" || exit 1
# tsx handles .ts imports from shared packages (main: ./src/index.ts)
# and missing .js extensions in ESM output (moduleResolution: bundler)
CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy && /app/node_modules/.bin/tsx dist/index.js"]
