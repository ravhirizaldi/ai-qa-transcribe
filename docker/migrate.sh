#!/usr/bin/env sh
set -eu

cd /app

echo "[migrate] generating drizzle artifacts"
pnpm --filter @ai-transcript/backend drizzle:generate

attempt=1
max_attempts="${DB_WAIT_MAX_ATTEMPTS:-30}"
sleep_seconds="${DB_WAIT_INTERVAL_SECONDS:-3}"

until pnpm --filter @ai-transcript/backend drizzle:migrate; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[migrate] database migration failed after ${attempt} attempts"
    exit 1
  fi

  echo "[migrate] database not ready yet, retrying in ${sleep_seconds}s"
  attempt=$((attempt + 1))
  sleep "$sleep_seconds"
done

echo "[migrate] migration completed"

