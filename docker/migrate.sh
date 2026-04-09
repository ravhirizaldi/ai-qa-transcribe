#!/usr/bin/env sh
set -eu

cd /app/backend

echo "[migrate] generating drizzle artifacts"
./node_modules/.bin/drizzle-kit generate

attempt=1
max_attempts="${DB_WAIT_MAX_ATTEMPTS:-30}"
sleep_seconds="${DB_WAIT_INTERVAL_SECONDS:-3}"

until ./node_modules/.bin/drizzle-kit migrate; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[migrate] database migration failed after ${attempt} attempts"
    exit 1
  fi

  echo "[migrate] database not ready yet, retrying in ${sleep_seconds}s"
  attempt=$((attempt + 1))
  sleep "$sleep_seconds"
done

echo "[migrate] migration completed"
