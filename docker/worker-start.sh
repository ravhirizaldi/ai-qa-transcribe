#!/usr/bin/env sh
set -eu

cd /app
exec pnpm --filter @ai-transcript/worker start

