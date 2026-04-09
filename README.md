# AI Transcript Apps

This folder contains a multi-tenant call QA system:

- `frontend`: Vue app (login, tenant/project management, settings, single/batch QA)
- `backend`: Fastify API (auth, tenants/projects, matrix, jobs, websocket)
- `worker`: pg-boss worker (transcribe -> analyze -> finalize)

## Behavior Notes

- New users are unrestricted by default and can view all tenants/projects.
- Admin can manually restrict visibility per user to selected tenants/projects.
- xAI API key/model are global settings used by all projects.
- ElevenLabs API key is also global and used by all projects.

## Prerequisites

- Node.js 20+
- pnpm 10+
- PostgreSQL 14+

## Install

From this `apps` directory:

```bash
pnpm install
```

## Environment Configuration

Create env files from examples:

```bash
cp backend/.env.example backend/.env
cp worker/.env.example worker/.env
cp frontend/.env.example frontend/.env
```

Update values:

- `backend/.env`
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `CORS_ORIGIN` (usually frontend URL)
  - `PORT` (default `3001`)
- `worker/.env`
  - `DATABASE_URL`
  - Optional fallback only: `ELEVENLABS_API_KEY`, `XAI_API_KEY`, `XAI_MODEL`
- `frontend/.env`
  - `VITE_API_BASE_URL` (for example `http://localhost:3001`)
  - `VITE_WS_URL` (for example `ws://localhost:3001/ws`)

## Database Setup

Generate and apply migrations:

```bash
pnpm --filter @ai-transcript/backend drizzle:generate
pnpm --filter @ai-transcript/backend drizzle:migrate
```

## Run the Project

Start each service in a separate terminal from `apps/`:

```bash
pnpm dev:backend
pnpm dev:worker
pnpm dev:frontend
```

Frontend default URL is typically `http://localhost:5173`.

## Seed First Admin User

There is no separate admin seed script. Use the bootstrap flow:

1. Register first user.
2. Create first tenant.
3. Tenant creator is automatically assigned `owner` on that tenant.

### Option A: Use UI

1. Open frontend `/login` and register.
2. Open `/manage` and create tenant/project.
3. Open `/settings`:
   - set global xAI key/model
   - set global ElevenLabs key
4. Use `/single` or `/batch` to process recordings.

### Option B: Use API (curl)

Register:

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'
```

Create tenant:

```bash
curl -X POST http://localhost:3001/tenants \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"CODEX","logoUrl":null}'
```

Create project:

```bash
curl -X POST http://localhost:3001/tenants/<TENANT_ID>/projects \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"CS Inbound","supportsInbound":true,"supportsOutbound":false}'
```

Set global provider settings:

```bash
curl -X PUT http://localhost:3001/settings/global \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"elevenlabsApiKey":"<ELEVENLABS_KEY>","xaiApiKey":"<XAI_KEY>","xaiModel":"grok-4-1-fast-non-reasoning"}'
```

Restrict user visibility manually (admin):

```bash
curl -X PUT http://localhost:3001/tenants/<TENANT_ID>/members/<USER_ID>/access \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"isRestricted":true,"role":"member","projectIds":["<PROJECT_ID>"]}'
```

## Useful Commands

Typecheck all workspaces:

```bash
pnpm -r typecheck
```

Build all workspaces:

```bash
pnpm -r build
```

## Production Docker

The repo now includes a production Docker stack with:

- optional `db`: PostgreSQL
- `migrate`: auto `drizzle:generate` + `drizzle:migrate`
- `backend`: Fastify API
- `worker`: pg-boss worker
- `frontend`: Nginx serving the Vue build and proxying `/api`, `/ws`, and `/uploads`

### Production Env

Create a production env file at the repo root:

```bash
cp .env.production.example .env.production
```

Important values to review:

- `USE_DOCKER_POSTGRES`
  set `true` to run PostgreSQL in Docker, `false` to use an existing PostgreSQL server
- `JWT_SECRET`
- `POSTGRES_PASSWORD`
  only required when `USE_DOCKER_POSTGRES=true`
- `DATABASE_URL`
  use `db` when `USE_DOCKER_POSTGRES=true`
  if PostgreSQL is already installed on the same Linux host, use `host.docker.internal` instead of `localhost`
- `CORS_ORIGIN`
  set this to the public URL that serves the frontend
- `PUBLIC_APP_PORT`
  host port for the web app
- `REMOVE_MIGRATE_IMAGE_AFTER_RUN`
  when `true`, the temporary migrate image is deleted automatically after a successful install/update

### First Install

On Linux:

```bash
./install.sh
```

What it does:

- builds the Docker images
- starts PostgreSQL
- runs Drizzle generation and migrations automatically
- starts backend, worker, and frontend

### Updating an Existing Deployment

On Linux:

```bash
./update.sh
```

What it does:

- pulls the latest git changes with `git pull --ff-only`
- rebuilds the images
- reruns Drizzle generation and migrations
- recreates the app containers

### Manual Docker Compose

If you want to run it directly without the helper scripts:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Frontend is exposed on `http://localhost:<PUBLIC_APP_PORT>`.
