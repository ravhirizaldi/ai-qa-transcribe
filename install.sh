#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.env.production"
ENV_EXAMPLE="${ROOT_DIR}/.env.production.example"

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

validate_env() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  local required_vars=(
    DATABASE_URL
    JWT_SECRET
    CORS_ORIGIN
    PUBLIC_APP_PORT
  )

  for name in "${required_vars[@]}"; do
    if [[ -z "${!name:-}" ]]; then
      echo "Missing required value in ${ENV_FILE}: ${name}" >&2
      exit 1
    fi
  done

  if [[ "${JWT_SECRET}" == "replace-with-a-long-random-secret" ]]; then
    echo "Update JWT_SECRET in ${ENV_FILE} before deploying." >&2
    exit 1
  fi

  if [[ "${USE_DOCKER_POSTGRES:-true}" == "true" ]]; then
    local db_required_vars=(
      POSTGRES_DB
      POSTGRES_USER
      POSTGRES_PASSWORD
    )

    for name in "${db_required_vars[@]}"; do
      if [[ -z "${!name:-}" ]]; then
        echo "Missing required value in ${ENV_FILE}: ${name}" >&2
        exit 1
      fi
    done

    if [[ "${POSTGRES_PASSWORD}" == "change-this-postgres-password" ]]; then
      echo "Update POSTGRES_PASSWORD in ${ENV_FILE} before deploying." >&2
      exit 1
    fi
  elif [[ "${DATABASE_URL}" == *"@localhost:"* || "${DATABASE_URL}" == *"@127.0.0.1:"* ]]; then
    echo "DATABASE_URL cannot use localhost from inside containers." >&2
    echo "For a Postgres server on the same Linux host, use host.docker.internal." >&2
    exit 1
  fi
}

compose_args=()

set_compose_args() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  compose_args=(--env-file "$ENV_FILE" -f "${ROOT_DIR}/docker-compose.prod.yml")
  if [[ "${USE_DOCKER_POSTGRES:-true}" == "true" ]]; then
    compose_args+=(-f "${ROOT_DIR}/docker-compose.prod.with-db.yml")
  fi
}

require_command docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created ${ENV_FILE} from example."
  echo "Update it with your production values, then rerun ./install.sh."
  exit 0
fi

validate_env
set_compose_args

docker compose "${compose_args[@]}" build
if [[ "${USE_DOCKER_POSTGRES:-true}" == "true" ]]; then
  docker compose "${compose_args[@]}" up -d db
fi
docker compose "${compose_args[@]}" run --rm migrate
docker compose "${compose_args[@]}" up -d backend worker frontend
cleanup_migrate_image
docker compose "${compose_args[@]}" ps
