#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

required_docs=(
  README.md
  QUICKSTART.md
  docs/ARCHITECTURE.md
  docs/DATABASE.md
  docs/API.md
  docs/REQUIREMENTS_TRACEABILITY.md
  docs/ASSUMPTIONS.md
  docs/INTEGRATIONS.md
  docs/TEST_REPORT.md
  docs/DEPLOYMENT.md
  docs/IOS_READINESS.md
  docs/IMPLEMENTATION_STATUS.md
  docs/CLIENT_DATA_REQUEST.md
)

for document in "${required_docs[@]}"; do
  test -s "$document" || {
    echo "Missing or empty required document: $document" >&2
    exit 1
  }
done

for trace_id in E7-RBAC-01 E8-MOBILE-01 E9-E2E-01 E10-INV-01 E10-CI-01 E11-DOCS-01 E11-DATA-01; do
  grep -Fq "$trace_id" docs/REQUIREMENTS_TRACEABILITY.md || {
    echo "Missing traceability row: $trace_id" >&2
    exit 1
  }
done

client_topics=(
  SUPER_ADMIN_PHONE_1
  DATABASE_URL
  REDIS_URL
  S3_BUCKET
  JWT_ACCESS_SECRET
  OTP_PROVIDER_MODE
  PAYMENT_PROVIDER_MODE
  FISCALIZATION_PROVIDER_MODE
  DELIVERY_PROVIDER_MODE
  DeliveryZone
  PUSH_PROVIDER_MODE
  JANTOK_DOMAIN
  Google\ Play
  Apple\ Developer
  CLUB
  referral
  HEX
  App\ Store
  формулы\ аналитики
  сотрудники
  карты
)

for topic in "${client_topics[@]}"; do
  grep -Fqi "$topic" docs/CLIENT_DATA_REQUEST.md || {
    echo "CLIENT_DATA_REQUEST is missing: $topic" >&2
    exit 1
  }
done

while IFS='=' read -r env_name _; do
  [[ "$env_name" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
  if ! grep -Fq "$env_name" docs/ENV_REQUIRED.md docs/CLIENT_DATA_REQUEST.md; then
    echo "Environment field is undocumented: $env_name" >&2
    exit 1
  fi
done < .env.example

model_count="$(rg -c '^model ' jantok-backend/prisma/schema.prisma)"
enum_count="$(rg -c '^enum ' jantok-backend/prisma/schema.prisma)"
migration_count="$(find jantok-backend/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
test "$model_count" = 111
test "$enum_count" = 59
test "$migration_count" = 15

while read -r _ model_name _; do
  grep -Fq "$model_name" docs/DATABASE.md || {
    echo "DATABASE.md does not mention Prisma model: $model_name" >&2
    exit 1
  }
done < <(rg '^model ' jantok-backend/prisma/schema.prisma)

if rg -n 'TODO|FIXME|HACK|XXX|UnimplementedError|notImplemented' \
  jantok-backend/src jantok-admin/src jantok-mobile/lib; then
  echo "Critical placeholder marker found in runtime source" >&2
  exit 1
fi

find scripts -type f -name '*.sh' -exec bash -n {} +
docker compose config --quiet
docker compose --env-file .env.staging.example \
  -f compose.yaml -f compose.staging.yaml config --quiet

backend_port="$(sed -n 's/^BACKEND_HOST_PORT=//p' .env 2>/dev/null | head -n 1)"
backend_port="${backend_port:-8080}"
if curl -fsS "http://localhost:${backend_port}/api/v1/health/ready" >/dev/null 2>&1; then
  openapi="$(curl -fsS "http://localhost:${backend_port}/api/docs-json")"
  jq -e '
    .openapi == "3.0.0" and
    (.paths | keys | length) >= 100 and
    ([.paths[] | to_entries[]] | length) >= 120 and
    (.components.schemas | keys | length) >= 60
  ' <<<"$openapi" >/dev/null
  echo "OpenAPI runtime verified on port $backend_port."
else
  echo "OpenAPI runtime check skipped: local API is not ready on port $backend_port."
fi

if [[ -f output/stage10/invariants.jsonl ]]; then
  jq -e -s 'length == 42 and all(.[]; .status == "passed")' \
    output/stage10/invariants.jsonl >/dev/null
fi

echo "Stage 11 documentation/final-audit checks passed."
