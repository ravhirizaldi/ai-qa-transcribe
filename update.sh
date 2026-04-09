#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.env.production"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

cleanup_migrate_image() {
  case "${REMOVE_MIGRATE_IMAGE_AFTER_RUN:-true}" in
    true|TRUE|1|yes|YES)
      docker image rm ai-qa-transcribe-migrate:latest >/dev/null 2>&1 || true
      ;;
  esac
}

require_command docker
require_command git

compose_args=()

set_compose_args() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  compose_args=(--env-file "$ENV_FILE" -f "${ROOT_DIR}/docker-compose.prod.yml")
  if [[ "${USE_DOCKER_POSTGRES:-true}" == "true" ]]; then
    compose_args+=(-f "${ROOT_DIR}/docker-compose.prod.with-db.yml")
  elif [[ "${DATABASE_URL:-}" == *"@localhost:"* || "${DATABASE_URL:-}" == *"@127.0.0.1:"* ]]; then
    echo "DATABASE_URL cannot use localhost from inside containers." >&2
    echo "For a Postgres server on the same Linux host, use host.docker.internal." >&2
    exit 1
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}. Run ./install.sh first." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required." >&2
  exit 1
fi

cd "$ROOT_DIR"

git pull --ff-only
set_compose_args

docker compose "${compose_args[@]}" build
if [[ "${USE_DOCKER_POSTGRES:-true}" == "true" ]]; then
  docker compose "${compose_args[@]}" up -d db
fi
docker compose "${compose_args[@]}" run --rm migrate
docker compose "${compose_args[@]}" up -d --remove-orphans backend worker frontend
cleanup_migrate_image
docker compose "${compose_args[@]}" ps
