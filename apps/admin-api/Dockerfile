FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@8.15.6 --activate

# Install deps
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/admin-api/package.json apps/admin-api/
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/utils/package.json packages/utils/
COPY packages/api-core/package.json packages/api-core/
RUN pnpm install --frozen-lockfile --filter @brett/admin-api... --filter @brett/api

# Build
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY packages/utils packages/utils
COPY packages/api-core packages/api-core
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY apps/admin-api apps/admin-api
RUN pnpm --filter @brett/api exec prisma generate
RUN pnpm --filter @brett/admin-api run build

# Run — no migrations (owned by apps/api)
FROM base AS runner
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/types packages/types
COPY --from=build /app/packages/utils packages/utils
COPY --from=build /app/packages/api-core packages/api-core
COPY --from=build /app/apps/admin-api/dist apps/admin-api/dist
COPY --from=build /app/apps/admin-api/node_modules apps/admin-api/node_modules
COPY --from=build /app/apps/admin-api/package.json apps/admin-api/package.json
WORKDIR /app/apps/admin-api
CMD ["node", "dist/index.js"]
