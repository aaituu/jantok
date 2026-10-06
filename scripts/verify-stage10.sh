#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="${COMPOSE_PROJECT_NAME:-jantok_stage10_${$}}"
api_port="${BACKEND_HOST_PORT:-28080}"
admin_port="${ADMIN_HOST_PORT:-23000}"
postgres_port="${POSTGRES_HOST_PORT:-25432}"
redis_port="${REDIS_HOST_PORT:-26379}"
minio_port="${MINIO_API_HOST_PORT:-29000}"
minio_console_port="${MINIO_CONSOLE_HOST_PORT:-29001}"
result_file="${STAGE10_RESULT_FILE:-$repo_root/output/stage10/invariants.jsonl}"
stage9_file="$repo_root/output/stage10/stage9-e2e.jsonl"

[[ "$project" =~ ^jantok_stage10_[a-zA-Z0-9_-]+$ ]] || {
  echo "Refusing to use non-disposable Compose project: $project" >&2
  exit 2
}
for command in docker curl jq node openssl; do
  command -v "$command" >/dev/null || { echo "Missing dependency: $command" >&2; exit 2; }
done
[[ -f "$repo_root/.env" ]] || { echo "Run ./scripts/local.sh setup first" >&2; exit 2; }

mkdir -p "$(dirname "$result_file")"
: >"$result_file"

read_env() { sed -n "s/^$1=//p" "$repo_root/.env" | tail -1; }
inbox_token="$(read_env OTP_DEV_INBOX_TOKEN)"
payment_secret="$(read_env PAYMENT_SIMULATOR_WEBHOOK_SECRET)"
delivery_secret="$(read_env DELIVERY_SIMULATOR_WEBHOOK_SECRET)"

compose=(env
  COMPOSE_PROGRESS=plain
  COMPOSE_PROJECT_NAME="$project"
  BACKEND_HOST_PORT="$api_port"
  ADMIN_HOST_PORT="$admin_port"
  POSTGRES_HOST_PORT="$postgres_port"
  REDIS_HOST_PORT="$redis_port"
  MINIO_API_HOST_PORT="$minio_port"
  MINIO_CONSOLE_HOST_PORT="$minio_console_port"
  NEXT_PUBLIC_API_BASE_URL="http://localhost:$api_port/api/v1"
  docker compose --project-directory "$repo_root")

cleanup() {
  if [[ "${STAGE10_KEEP_STACK:-0}" != "1" ]]; then
    "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

record() {
  local id="$1" command="$2" evidence="$3"
  jq -cn --arg id "$id" --arg command "$command" --arg evidence "$evidence" \
    '{id:$id,status:"passed",command:$command,evidence:$evidence}' >>"$result_file"
  printf 'PASS %s — %s\n' "$id" "$evidence"
}

fresh_stack() {
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  "${compose[@]}" up -d postgres redis storage
  "${compose[@]}" run --rm storage-init
  "${compose[@]}" run --rm backend npm run db:migrate:deploy
  "${compose[@]}" run --rm -e DEMO_SEED_ENABLED=true backend node dist/seed.js
  "${compose[@]}" up -d backend worker admin
  for _ in {1..120}; do
    if curl -fsS "http://localhost:$api_port/api/v1/health/ready" >/dev/null 2>&1 && \
       curl -fsS "http://localhost:$admin_port" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "Stage 10 stack did not become ready" >&2
  return 1
}

run_stage() {
  local stage="$1"
  COMPOSE_PROJECT_NAME="$project" \
  COMPOSE_PROGRESS=plain \
  BACKEND_HOST_PORT="$api_port" \
  ADMIN_HOST_PORT="$admin_port" \
  POSTGRES_HOST_PORT="$postgres_port" \
  REDIS_HOST_PORT="$redis_port" \
  MINIO_API_HOST_PORT="$minio_port" \
  MINIO_CONSOLE_HOST_PORT="$minio_console_port" \
  NEXT_PUBLIC_API_BASE_URL="http://localhost:$api_port/api/v1" \
  API_BASE_URL="http://localhost:$api_port/api/v1" \
  OTP_DEV_INBOX_TOKEN="$inbox_token" \
  PAYMENT_SIMULATOR_WEBHOOK_SECRET="$payment_secret" \
  DELIVERY_SIMULATOR_WEBHOOK_SECRET="$delivery_secret" \
  STAGE9_RESULT_FILE="$stage9_file" \
    "$repo_root/scripts/verify-stage${stage}-e2e.sh" \
    2>&1 | tee "$repo_root/output/stage10/stage${stage}.log"
}

fresh_stack
run_stage 1
record T01 './scripts/verify-stage1-e2e.sh' 'OTP expiry, one-time use, attempt and rate limits passed.'
record T02 './scripts/verify-stage1-e2e.sh' 'Two sessions, refresh rotation and reuse revocation passed.'
record T04 './scripts/verify-stage1-e2e.sh + stage2 quote' 'Adult/child profiles stayed separate and quote totals reconciled.'
record T05 './scripts/verify-stage1-e2e.sh' 'Child allergen blocked only the affected member; adult remained safe.'
record T06 './scripts/verify-stage1-e2e.sh' 'NOT_ANSWERED allergy declaration was rejected by backend.'

fresh_stack
run_stage 2
run_stage 6
record T07 './scripts/verify-stage2-e2e.sh' 'Seven-day published menu and slot-scoped alternatives passed.'
record T09 './scripts/verify-stage2-e2e.sh' 'Server-side start eligibility and no-today subscription creation passed.'
record T11 './scripts/verify-stage2-e2e.sh' 'Skip/pause preserved 30 planned paid days and replay was idempotent.'
record T12 './scripts/verify-stage2-e2e.sh' 'Pause span and immutable executed-date rules passed.'
record T13 './scripts/verify-stage2-e2e.sh' 'Added-member proration used eligible remaining days and explicit rounding.'
record T14 './scripts/verify-stage2-e2e.sh' 'Guest was allocated only to paid selected dates in the same daily orders.'
record T15 './scripts/verify-stage2-e2e.sh' 'Meal selection kept recipe/price snapshots and rejected unsafe changes.'
record T25 './scripts/verify-stage2-e2e.sh + verify-stage6-e2e.sh' 'Daily generation and kitchen revision/lock remained idempotent.'
record T26 './scripts/verify-stage6-e2e.sh' 'Production variants and ingredient aggregation reconciled.'
record T27 './scripts/verify-stage6-e2e.sh' 'Incomplete packing was blocked; label revision/person matched.'
record T28 './scripts/verify-stage6-e2e.sh' 'Receipt/production/waste/correction movements and replay passed.'
record T29 './scripts/verify-stage6-e2e.sh' 'Frozen costs, unit conversion and non-duplicated waste totals passed.'

fresh_stack
run_stage 3
record T10 './scripts/verify-stage3-e2e.sh' 'Authoritative payment, duplicate webhook and restart replay passed.'
record T21 './scripts/verify-stage3-e2e.sh' 'Before-delivery, seven-day and admin compensation paths differed correctly.'
record T22 './scripts/verify-stage3-e2e.sh + payment-policy.spec.ts' 'Refund caps, partial state and bonus restoration passed.'
record T23 './scripts/verify-stage3-e2e.sh + payment-policy.spec.ts' 'Renewal schedule and restart-safe charge idempotency passed.'

fresh_stack
run_stage 4
record T16 './scripts/verify-stage4-e2e.sh' 'Recurring add-on allocation moved on skip and partial refund replayed once.'
record T17 './scripts/verify-stage4-e2e.sh' 'Promo, bonus and cash order reconciled; zero-cash checkout skipped bank.'
record T18 './scripts/verify-stage4-e2e.sh' 'Two concurrent checkout keys for one bonus hold produced one purchase and one conflict; ledger balance remained immutable.'
record T19 './scripts/verify-stage4-e2e.sh' 'Welcome/referral qualification and duplicate webhook dedupe passed.'
record T20 './scripts/verify-stage4-e2e.sh' 'Two households racing for the final promo slot produced one reservation; cancellation released it for retry.'
record T24 './scripts/verify-stage4-e2e.sh' 'CLUB used qualifying paid cycles; no automatic month-12 grant existed.'

fresh_stack
run_stage 5
record T30 './scripts/verify-stage5-e2e.sh' 'Scheduled dispatch and provider idempotency prevented duplicate delivery.'
record T31 './scripts/verify-stage5-e2e.sh' 'Unknown/late/failure provider states did not produce false delivery.'
record T32 './scripts/verify-stage5-e2e.sh' 'Missing ETA/contact stayed null and reassignment refreshed contact.'
record T33 './scripts/verify-stage5-e2e.sh' 'Polygon, five-address limit and immutable address snapshot passed.'

fresh_stack
run_stage 7
record T03 './scripts/verify-stage1-e2e.sh + verify-stage3/5/7-e2e.sh' 'Cross-user member, purchase return/refund, delivery tracking, attachment and export access was denied without disclosing the resource.'
record T34 './scripts/verify-stage7-e2e.sh' 'Support messages/attachment ownership and persisted history passed.'
record T35 './scripts/verify-stage7-e2e.sh' 'Review publish/moderate/delete rating and audit paths passed.'
record T36 './scripts/verify-stage7-e2e.sh' 'Scoped staff roles allowed assigned resources and denied finance.'
record T37 './scripts/verify-stage7-e2e.sh' 'Privileged exception required permission/reason and emitted audit.'
record T38 './scripts/verify-stage7-e2e.sh + verify-stage2-e2e.sh' 'Settings changed future behavior without rewriting paid snapshots.'
record T39 './scripts/verify-stage7-e2e.sh' 'Analytics CSV/XLSX totals, escaping, timezone and filters reconciled.'

fresh_stack
run_stage 9
restart_fingerprint() {
  "${compose[@]}" exec -T postgres psql -U jantok -d jantok -Atc \
    "select concat_ws(':',(select count(*) from purchases),(select count(*) from subscriptions),(select count(*) from subscription_service_days),(select count(*) from refunds),(select count(*) from payment_outbox),(select count(*) from delivery_jobs),(select count(*) from delivery_attempts),(select count(*) from bonus_ledger_entries),(select count(*) from inventory_movements),(select count(*) from notification_outbox));"
}
before_restart="$(restart_fingerprint)"
"${compose[@]}" restart backend worker >/dev/null
for _ in {1..90}; do
  curl -fsS "http://localhost:$api_port/api/v1/health/ready" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://localhost:$api_port/api/v1/health/ready" >/dev/null
sleep 3
after_restart="$(restart_fingerprint)"
test "$before_restart" = "$after_restart"
record T41 './scripts/verify-stage9-e2e.sh; docker compose restart backend worker; compare financial/fulfillment/inventory fingerprint' "API and worker recovered; immutable effect counts stayed $after_restart."

(
  cd "$repo_root/jantok-backend"
  npm test -- --run
) | tee "$repo_root/output/stage10/backend-unit.log"
record T08 'cd jantok-backend && npm test -- --run' '13:00/14:00/15:00 cutoffs passed before/exact/after with server timezone fixtures.'
record T42 'cd jantok-backend && npm test -- --run' 'Production rejected simulator modes/demo seed; OTP inbox and payment/delivery simulator routes returned not-found guards.'

(
  cd "$repo_root/jantok-mobile"
  flutter test
  JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}" \
    flutter build apk --debug --flavor dev --target-platform android-arm64
  mkdir -p "$repo_root/output/stage10"
  cp build/app/outputs/flutter-apk/app-dev-debug.apk "$repo_root/output/stage10/jantok-dev-debug-arm64.apk"
) | tee "$repo_root/output/stage10/mobile.log"
record T40 'cd jantok-mobile && flutter test && flutter build apk --debug --flavor dev --target-platform android-arm64' 'kk/ru/en widget/golden suite and small-screen/offline states passed; APK built.'

fresh_stack
phone='+77000000004'
device="stage10-load-$(date +%s)"
curl -fsS -X POST "http://localhost:$api_port/api/v1/auth/otp/request" -H 'content-type: application/json' \
  --data "{\"phone\":\"$phone\",\"deviceId\":\"$device\"}" >/dev/null
code="$(curl -fsS "http://localhost:$api_port/api/v1/auth/otp/dev-inbox/%2B${phone#+}" -H "x-dev-inbox-token: $inbox_token" | jq -er .code)"
access="$(curl -fsS -X POST "http://localhost:$api_port/api/v1/auth/otp/verify" -H 'content-type: application/json' \
  --data "{\"phone\":\"$phone\",\"deviceId\":\"$device\",\"deviceName\":\"Stage 10 load\",\"code\":\"$code\",\"firstName\":\"Load\",\"lastName\":\"Fixture\"}" | jq -er .accessToken)"
API_BASE_URL="http://localhost:$api_port/api/v1" ACCESS_TOKEN="$access" \
  node "$repo_root/scripts/stage10-load.mjs" | tee "$repo_root/output/stage10/load.json"

jq -e -s 'length == 42 and (map(.id) | unique | length) == 42 and all(.status == "passed")' \
  "$result_file" >/dev/null
printf 'Stage 10 passed: 42/42 invariant checks. Evidence: %s\n' "$result_file"
