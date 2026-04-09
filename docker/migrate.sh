#!/usr/bin/env sh
set -eu

cd /app/backend

attempt=1
max_attempts="${DB_WAIT_MAX_ATTEMPTS:-30}"
sleep_seconds="${DB_WAIT_INTERVAL_SECONDS:-3}"
generate_on_deploy="${GENERATE_MIGRATIONS_ON_DEPLOY:-false}"

case "$generate_on_deploy" in
  true|TRUE|1|yes|YES)
    echo "[migrate] generating drizzle artifacts"
    ./node_modules/.bin/drizzle-kit generate
    ;;
  *)
    echo "[migrate] skipping drizzle generate on deploy"
    ;;
esac

is_retryable_error() {
  case "$1" in
    *"ECONNREFUSED"*|*"ENOTFOUND"*|*"Connection terminated unexpectedly"*|*"database system is starting up"*|*"timeout expired"*|*"getaddrinfo"*|*"Can't reach database server"*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

while true; do
  set +e
  output="$(./node_modules/.bin/drizzle-kit migrate 2>&1)"
  status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    printf '%s\n' "$output"
    break
  fi

  printf '%s\n' "$output"

  if ! is_retryable_error "$output"; then
    echo "[migrate] migration failed with a non-retryable error"
    exit "$status"
  fi

  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[migrate] database migration failed after ${attempt} attempts"
    exit 1
  fi

  echo "[migrate] database not ready yet, retrying in ${sleep_seconds}s"
  attempt=$((attempt + 1))
  sleep "$sleep_seconds"
done

echo "[migrate] migration completed"
