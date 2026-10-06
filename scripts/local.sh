#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"
command_name="${1:-help}"
shift || true

compose() {
  docker compose --project-directory "$repo_root" "$@"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command is missing: $1" >&2
    exit 1
  }
}

check_dependencies() {
  for dependency in docker curl jq openssl; do
    require_command "$dependency"
  done
  docker compose version >/dev/null
  docker info >/dev/null
}

set_env_value() {
  local key="$1" value="$2" temporary
  temporary="$(mktemp "${env_file}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 { print key "=" value; replaced = 1; next }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$env_file" >"$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$env_file"
}

ensure_local_env() {
  if [[ -f "$env_file" ]]; then
    echo "Keeping existing $env_file unchanged."
    return
  fi
  cp "$repo_root/.env.example" "$env_file"
  chmod 600 "$env_file"
  local postgres_password storage_secret storage_access
  postgres_password="$(openssl rand -hex 24)"
  storage_secret="$(openssl rand -hex 32)"
  storage_access="jantok_$(openssl rand -hex 12)"
  set_env_value POSTGRES_PASSWORD "$postgres_password"
  set_env_value DATABASE_URL "postgresql://jantok:${postgres_password}@postgres:5432/jantok?schema=public"
  set_env_value MINIO_ROOT_USER "$storage_access"
  set_env_value MINIO_ROOT_PASSWORD "$storage_secret"
  set_env_value S3_ACCESS_KEY_ID "$storage_access"
  set_env_value S3_SECRET_ACCESS_KEY "$storage_secret"
  set_env_value JWT_ACCESS_SECRET "$(openssl rand -hex 32)"
  set_env_value JWT_REFRESH_SECRET "$(openssl rand -hex 32)"
  set_env_value SESSION_SECRET "$(openssl rand -hex 32)"
  set_env_value OTP_HASH_SECRET "$(openssl rand -hex 32)"
  set_env_value OTP_DEV_INBOX_TOKEN "$(openssl rand -hex 32)"
  set_env_value PII_ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_env_value PAYMENT_SIMULATOR_WEBHOOK_SECRET "$(openssl rand -hex 32)"
  set_env_value DELIVERY_SIMULATOR_WEBHOOK_SECRET "$(openssl rand -hex 32)"
  echo "Created private local .env with generated secrets."
}

assert_local_environment() {
  local configured
  configured="$(sed -n 's/^APP_ENV=//p' "$env_file" | tail -1)"
  case "$configured" in
    local|test) ;;
    *)
      echo "This command is restricted to APP_ENV=local or test (found: ${configured:-unset})." >&2
      exit 1
      ;;
  esac
}

env_value() {
  sed -n "s/^$1=//p" "$env_file" | tail -1
}

migrate() {
  compose up --detach --wait postgres redis storage
  compose up storage-init
  compose run --rm backend npm run db:migrate:deploy
}

seed() {
  assert_local_environment
  compose up --detach --wait postgres redis storage
  compose up storage-init
  compose run --rm -e DEMO_SEED_ENABLED=true backend node dist/seed.js
}

wait_for_url() {
  local url="$1" attempts="${2:-90}"
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then return; fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

wait_for_service_running() {
  local service="$1" attempts="${2:-60}" state stable=0
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    state="$(compose ps --format json "$service" 2>/dev/null | jq -r '.State // empty' | head -1)"
    if [[ "$state" == "running" ]]; then
      stable=$((stable + 1))
      if ((stable >= 3)); then return; fi
    else
      stable=0
    fi
    sleep 1
  done
  echo "Timed out waiting for Compose service $service to stay running" >&2
  compose ps -a "$service" >&2 || true
  return 1
}

backup() {
  assert_local_environment
  local backup_root timestamp destination storage_container service
  local running_writers=()
  backup_root="$(env_value LOCAL_BACKUP_DIR)"
  backup_root="${backup_root:-$repo_root/backups}"
  [[ "$backup_root" = /* ]] || backup_root="$repo_root/${backup_root#./}"
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  destination="$backup_root/$timestamp"
  mkdir -p "$destination"
  for service in backend worker admin; do
    if [[ -n "$(compose ps --status running -q "$service")" ]]; then
      running_writers+=("$service")
    fi
  done
  restart_backup_writers() {
    if ((${#running_writers[@]} > 0)); then
      compose start "${running_writers[@]}" >/dev/null 2>&1 || true
    fi
  }
  trap restart_backup_writers EXIT
  if ((${#running_writers[@]} > 0)); then
    compose stop "${running_writers[@]}" >/dev/null
  fi
  compose up --detach --wait postgres storage
  storage_container="$(compose ps -q storage)"
  [[ -n "$storage_container" ]] || {
    echo "Object-storage container is not running." >&2
    exit 1
  }
  compose exec -T postgres sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$destination/postgres.dump"
  docker run --rm --volumes-from "$storage_container" postgres:17-alpine \
    tar -C /data -czf - . >"$destination/object-storage.tar.gz"
  jq -n --arg createdAt "$timestamp" --arg appEnv "$(env_value APP_ENV)" \
    '{formatVersion:1,createdAt:$createdAt,appEnv:$appEnv,contents:["postgres.dump","object-storage.tar.gz"]}' \
    >"$destination/manifest.json"
  restart_backup_writers
  trap - EXIT
  echo "Backup created: $destination"
}

restore() {
  assert_local_environment
  local source="${1:-}" confirmation="${2:-}" storage_container
  if [[ -z "$source" || "$confirmation" != "--confirm-local-restore" ]]; then
    echo "Usage: ./scripts/local.sh restore BACKUP_DIR --confirm-local-restore" >&2
    exit 1
  fi
  source="$(cd "$source" && pwd)"
  for file in manifest.json postgres.dump object-storage.tar.gz; do
    [[ -f "$source/$file" ]] || {
      echo "Backup is missing $file: $source" >&2
      exit 1
    }
  done
  compose stop backend worker admin >/dev/null 2>&1 || true
  compose up --detach --wait postgres storage
  storage_container="$(compose ps -q storage)"
  [[ -n "$storage_container" ]] || {
    echo "Object-storage container is not running." >&2
    exit 1
  }
  compose exec -T postgres sh -ec 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
  compose exec -T postgres sh -ec 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' <"$source/postgres.dump"
  docker run --rm --volumes-from "$storage_container" postgres:17-alpine sh -ec \
    'for entry in /data/..?* /data/.[!.]* /data/*; do [ -e "$entry" ] || continue; rm -rf -- "$entry"; done'
  docker run --rm -i --volumes-from "$storage_container" postgres:17-alpine \
    tar -C /data -xzf - <"$source/object-storage.tar.gz"
  echo "Restore completed from $source. Run './scripts/local.sh start' to restart applications."
}

case "$command_name" in
  setup)
    check_dependencies
    ensure_local_env
    assert_local_environment
    compose build
    migrate
    if [[ "${1:-}" == "--demo" ]]; then seed; fi
    ;;
  start)
    check_dependencies
    ensure_local_env
    compose up --build --detach
    backend_port="${BACKEND_HOST_PORT:-$(env_value BACKEND_HOST_PORT)}"
    admin_port="${ADMIN_HOST_PORT:-$(env_value ADMIN_HOST_PORT)}"
    wait_for_url "http://localhost:${backend_port:-8080}/api/v1/health/ready" 120
    wait_for_url "http://localhost:${admin_port:-3000}" 60
    wait_for_service_running worker 60
    ;;
  stop)
    compose down
    ;;
  migrate)
    check_dependencies
    ensure_local_env
    migrate
    ;;
  seed)
    check_dependencies
    ensure_local_env
    seed
    ;;
  verify)
    check_dependencies
    backend_port="${BACKEND_HOST_PORT:-$(env_value BACKEND_HOST_PORT)}"
    admin_port="${ADMIN_HOST_PORT:-$(env_value ADMIN_HOST_PORT)}"
    curl --fail --silent --show-error "http://localhost:${backend_port:-8080}/api/v1/health/ready" | jq -e '.status == "ok"' >/dev/null
    curl --fail --silent --show-error "http://localhost:${admin_port:-3000}" >/dev/null
    wait_for_service_running worker 10
    API_BASE_URL="${API_BASE_URL:-http://localhost:${backend_port:-8080}/api/v1}" \
      "$repo_root/scripts/verify-stage9-e2e.sh"
    ;;
  backup)
    check_dependencies
    ensure_local_env
    backup
    ;;
  restore)
    check_dependencies
    ensure_local_env
    restore "$@"
    ;;
  help|*)
    cat <<'USAGE'
Usage: ./scripts/local.sh COMMAND

  setup [--demo]  Check tools, create missing .env, build, migrate, optionally seed
  start           Start/update the stack without deleting data
  stop            Stop the stack and preserve volumes
  migrate         Apply committed migrations
  seed            Run the idempotent demo catalog seed (local/test only)
  verify          Run health checks and the Stage 9 real-API scenario
  backup          Back up PostgreSQL and object storage
  restore DIR --confirm-local-restore
                  Restore a backup into an explicitly local/test environment
USAGE
    ;;
esac
