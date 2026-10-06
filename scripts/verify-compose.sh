#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project_name="jantok_clean_verify"

cleanup() {
  docker compose --project-directory "$repo_root" --project-name "$project_name" down --volumes
}
trap cleanup EXIT

docker compose --project-directory "$repo_root" --project-name "$project_name" up --build --detach --wait
curl --fail --silent --show-error http://localhost:8080/api/v1/health/ready
curl --fail --silent --show-error http://localhost:3000 >/dev/null
docker compose --project-directory "$repo_root" --project-name "$project_name" exec -T postgres \
  psql -U jantok -d jantok -v ON_ERROR_STOP=1 -c \
  "SELECT migration_name, finished_at IS NOT NULL AS applied FROM _prisma_migrations ORDER BY finished_at;"
