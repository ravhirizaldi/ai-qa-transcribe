# AI Transcript Apps

This folder contains a multi-tenant call QA system:

- `frontend`: Vue app (login, tenant/project management, settings, single/batch QA)
- `backend`: Fastify API (auth, tenants/projects, matrix, jobs, websocket)
- `worker`: pg-boss worker (transcribe -> analyze -> finalize)

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
  - Optional fallback: `ELEVENLABS_API_KEY`, `XAI_API_KEY`, `XAI_MODEL`
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

There is no separate admin seed script yet. Use the API bootstrap flow:

1. Register your first user (this becomes your authenticated user).
2. Create your first tenant with that user.
3. The creator is automatically added as tenant `owner` (admin role for tenant management).

### Option A: Use UI (recommended)

1. Open frontend `/login` and register.
2. Go to `/manage` and create your first tenant.
3. Create projects under that tenant.
4. Go to `/settings` and save provider keys per project.

### Option B: Use API directly (curl)

Register:

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe123!"}'
```

Copy the returned `token`, then create tenant:

```bash
curl -X POST http://localhost:3001/tenants \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"CODEX","logoUrl":null}'
```

Create project under tenant:

```bash
curl -X POST http://localhost:3001/tenants/<TENANT_ID>/projects \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"name":"CS Inbound","supportsInbound":true,"supportsOutbound":false}'
```

Set provider settings for project:

```bash
curl -X PUT http://localhost:3001/projects/<PROJECT_ID>/settings \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"elevenlabsApiKey":"<ELEVENLABS_KEY>","xaiApiKey":"<XAI_KEY>","xaiModel":"grok-4-1-fast-non-reasoning"}'
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
