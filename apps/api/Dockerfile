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
RUN pnpm install --frozen-lockfile --filter @brett/api...

# Build
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY packages/utils packages/utils
COPY packages/business packages/business
COPY apps/api apps/api
RUN pnpm --filter @brett/api exec prisma generate
RUN pnpm --filter @brett/api run build

# Run
FROM base AS runner
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/types packages/types
COPY --from=build /app/packages/utils packages/utils
COPY --from=build /app/packages/business packages/business
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/prisma apps/api/prisma
COPY --from=build /app/apps/api/package.json apps/api/package.json
WORKDIR /app/apps/api
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/index.js"]
