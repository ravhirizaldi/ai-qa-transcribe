FROM node:20-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY worker/package.json worker/package.json
COPY shared/package.json shared/package.json

FROM base AS app-build-deps

RUN pnpm install --frozen-lockfile --filter @ai-transcript/backend... --filter @ai-transcript/worker...

FROM app-build-deps AS app-build

COPY backend backend
COPY worker worker
COPY shared shared

RUN pnpm --filter @ai-transcript/shared build \
 && pnpm --filter @ai-transcript/backend build \
 && pnpm --filter @ai-transcript/worker build

FROM base AS app-prod-deps

RUN pnpm install --prod --frozen-lockfile --filter @ai-transcript/backend... --filter @ai-transcript/worker...

FROM base AS migrate-deps

RUN pnpm install --frozen-lockfile --filter @ai-transcript/backend...

FROM node:20-alpine AS app-runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=app-prod-deps /app/package.json /app/package.json
COPY --from=app-prod-deps /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=app-prod-deps /app/node_modules /app/node_modules
COPY --from=app-prod-deps /app/backend /app/backend
COPY --from=app-prod-deps /app/worker /app/worker
COPY --from=app-prod-deps /app/shared /app/shared
COPY --from=app-build /app/backend/dist /app/backend/dist
COPY --from=app-build /app/worker/dist /app/worker/dist
COPY --from=app-build /app/shared/dist /app/shared/dist
COPY docker/backend-start.sh /app/docker/backend-start.sh
COPY docker/worker-start.sh /app/docker/worker-start.sh

RUN mkdir -p /app/backend/uploads

FROM node:20-alpine AS migrate-runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=migrate-deps /app/package.json /app/package.json
COPY --from=migrate-deps /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=migrate-deps /app/node_modules /app/node_modules
COPY --from=migrate-deps /app/backend /app/backend
COPY --from=migrate-deps /app/shared /app/shared
COPY backend/drizzle /app/backend/drizzle
COPY backend/drizzle.config.ts /app/backend/drizzle.config.ts
COPY docker/migrate.sh /app/docker/migrate.sh
