#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
INBOX_TOKEN="${OTP_DEV_INBOX_TOKEN:-local-dev-inbox-token-change-before-sharing}"
DELIVERY_SECRET="${DELIVERY_SIMULATOR_WEBHOOK_SECRET:-local-delivery-webhook-secret-change-before-sharing}"
DB_NAME="${STAGE5_DB_NAME:-jantok}"
CLIENT_PHONE="${STAGE5_CLIENT_PHONE:-+77000000001}"
FOREIGN_PHONE="${STAGE5_FOREIGN_PHONE:-+77000000002}"
STAFF_PHONE="${STAGE5_STAFF_PHONE:-+77000000003}"
run_id="stage5-$(date +%s)"
start_date="$(date -v+2d +%F 2>/dev/null || date -d '+2 days' +%F)"

login() {
  local phone="$1" device="$2" first="$3"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/request" -H 'content-type: application/json' \
    --data "{\"phone\":\"$phone\",\"deviceId\":\"$device\"}" >/dev/null
  local code
  code="$(curl -fsS "$API_BASE_URL/auth/otp/dev-inbox/%2B${phone#+}" -H "x-dev-inbox-token: $INBOX_TOKEN" | jq -er '.code')"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' \
    --data "{\"phone\":\"$phone\",\"deviceId\":\"$device\",\"deviceName\":\"Stage 5 E2E\",\"code\":\"$code\",\"firstName\":\"$first\",\"lastName\":\"E2E\"}" | jq -er '.accessToken'
}

CLIENT_ACCESS="$(login "$CLIENT_PHONE" "$run_id-client" Client)"
FOREIGN_ACCESS="$(login "$FOREIGN_PHONE" "$run_id-foreign" Foreign)"
STAFF_ACCESS="$(login "$STAFF_PHONE" "$run_id-staff" Staff)"
client_auth=(-H "authorization: Bearer $CLIENT_ACCESS")
foreign_auth=(-H "authorization: Bearer $FOREIGN_ACCESS")
staff_auth=(-H "authorization: Bearer $STAFF_ACCESS")

member_id="$(curl -fsS -X POST "$API_BASE_URL/household/members" "${client_auth[@]}" -H 'content-type: application/json' \
  --data '{"firstName":"Stage5","birthDate":"1990-01-01"}' | jq -er '.id')"
catalogs="$(curl -fsS "$API_BASE_URL/catalogs/questionnaire" "${client_auth[@]}")"
activity="$(printf '%s' "$catalogs" | jq -er '.activityLevels[0].id')"
diet="$(printf '%s' "$catalogs" | jq -er '.dietTypes[0].id')"
curl -fsS -X PUT "$API_BASE_URL/household/members/$member_id/questionnaire" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "{\"biologicalSex\":\"UNSPECIFIED\",\"heightCm\":175,\"weightKg\":70,\"activityLevelId\":\"$activity\",\"sportIntensity\":\"NONE\",\"sportHoursPerWeek\":0,\"goal\":\"MAINTAIN\",\"dietTypeId\":\"$diet\",\"allergyDeclarationStatus\":\"NONE\",\"portionPreference\":\"RECOMMENDED\",\"sportTypeIds\":[],\"allergies\":[],\"preferences\":[]}" >/dev/null
address_id="$(curl -fsS -X POST "$API_BASE_URL/household/addresses" "${client_auth[@]}" -H 'content-type: application/json' \
  --data '{"label":"Дом","streetAddress":"Stage 5 demo address","latitude":51.1282,"longitude":71.4304}' | jq -er '.id')"

outside_status="$(curl -sS -o /tmp/jantok-stage5-outside.json -w '%{http_code}' -X POST "$API_BASE_URL/household/addresses" "${client_auth[@]}" -H 'content-type: application/json' \
  --data '{"label":"Вне зоны","streetAddress":"Outside polygon","latitude":51.40,"longitude":71.90,"isDefault":false}')"
test "$outside_status" = '422'
jq -e '.error.code == "ADDRESS_OUTSIDE_DELIVERY_ZONE"' /tmp/jantok-stage5-outside.json >/dev/null

for number in 2 3 4 5; do
  curl -fsS -X POST "$API_BASE_URL/household/addresses" "${client_auth[@]}" -H 'content-type: application/json' \
    --data "{\"label\":\"Address $number\",\"streetAddress\":\"Stage 5 address $number\",\"latitude\":51.1282,\"longitude\":71.4304,\"isDefault\":false}" >/dev/null
done
sixth_status="$(curl -sS -o /tmp/jantok-stage5-sixth.json -w '%{http_code}' -X POST "$API_BASE_URL/household/addresses" "${client_auth[@]}" -H 'content-type: application/json' \
  --data '{"label":"Sixth","streetAddress":"Rejected sixth address","latitude":51.1282,"longitude":71.4304,"isDefault":false}')"
test "$sixth_status" = '409'
jq -e '.error.code == "ADDRESS_LIMIT_REACHED"' /tmp/jantok-stage5-sixth.json >/dev/null

quote_id="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/quotes" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "{\"addressId\":\"$address_id\",\"startDate\":\"$start_date\",\"memberIds\":[\"$member_id\"]}" | jq -er '.id')"
subscription="$(curl -fsS -X POST "$API_BASE_URL/payments/checkout" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "{\"quoteId\":\"$quote_id\",\"idempotencyKey\":\"$run_id-checkout\",\"autoRenew\":false}")"
service_day_id="$(printf '%s' "$subscription" | jq -er '.serviceDays[0].id')"

fulfillment="$(curl -fsS -X POST "$API_BASE_URL/staff/daily-orders/generate" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "{\"serviceDayId\":\"$service_day_id\"}")"
fulfillment_id="$(printf '%s' "$fulfillment" | jq -er '.id')"
foreign_tracking_status="$(curl -sS -o /tmp/jantok-stage5-foreign-tracking.json -w '%{http_code}' \
  "$API_BASE_URL/deliveries/daily-orders/$fulfillment_id/tracking" "${foreign_auth[@]}")"
test "$foreign_tracking_status" = '404'

# The finalizer is system-only. Seed its already-audited result so this test can
# focus on READY scheduling and provider idempotency without waiting for cutoff.
docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "update daily_fulfillments set status='LOCKED',version=1 where id='$fulfillment_id'; insert into daily_fulfillment_events (fulfillment_id,idempotency_key,type,from_status,to_status,actor_type,reason) values ('$fulfillment_id','$run_id-lock','STATUS_TRANSITION','SCHEDULED','LOCKED','SYSTEM','Stage 5 E2E finalizer');" >/dev/null

version=1
for status in IN_PRODUCTION COOKED PACKING READY; do
  transitioned="$(curl -fsS -X POST "$API_BASE_URL/staff/daily-orders/$fulfillment_id/transitions" "${staff_auth[@]}" -H 'content-type: application/json' \
    --data "{\"to\":\"$status\",\"expectedVersion\":$version,\"idempotencyKey\":\"$run_id-$status\",\"reason\":\"Stage 5 E2E controlled transition\"}")"
  version="$(printf '%s' "$transitioned" | jq -er '.version')"
done

# READY at night/far before the chosen slot only schedules a persisted job.
curl -fsS -X POST "$API_BASE_URL/staff/daily-orders/maintenance/run" "${staff_auth[@]}" | jq -e '.processed == 0' >/dev/null
attempts_before="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from delivery_attempts where fulfillment_id='$fulfillment_id'")"
test "$attempts_before" = '0'

# Make the persisted job due, then run it twice as after a restart. The second
# run must not create another provider operation/courier.
docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "update delivery_jobs set dispatch_at=now()-interval '1 minute',next_attempt_at=now()-interval '1 minute' where fulfillment_id='$fulfillment_id';" >/dev/null
curl -fsS -X POST "$API_BASE_URL/staff/daily-orders/maintenance/run" "${staff_auth[@]}" | jq -e '.processed == 1' >/dev/null
curl -fsS -X POST "$API_BASE_URL/staff/daily-orders/maintenance/run" "${staff_auth[@]}" | jq -e '.processed == 0' >/dev/null
attempt_count="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from delivery_attempts where fulfillment_id='$fulfillment_id'")"
test "$attempt_count" = '1'
provider_reference="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select provider_reference from delivery_attempts where fulfillment_id='$fulfillment_id'")"

event_body="$(jq -cn --arg id "$run_id-failed" --arg ref "$provider_reference" '{eventId:$id,providerReference:$ref,status:"failed",updatedAt:"2099-01-01T00:00:00.000Z",payload:{simulator:true}}')"
curl -fsS -X POST "$API_BASE_URL/deliveries/webhooks/local-simulator" -H 'content-type: application/json' -H "x-simulator-secret: $DELIVERY_SECRET" --data "$event_body" | jq -e '.result == "PROCESSED"' >/dev/null
curl -fsS -X POST "$API_BASE_URL/deliveries/webhooks/local-simulator" -H 'content-type: application/json' -H "x-simulator-secret: $DELIVERY_SECRET" --data "$event_body" | jq -e '.duplicate == true' >/dev/null
tracking="$(curl -fsS "$API_BASE_URL/deliveries/daily-orders/$fulfillment_id/tracking" "${client_auth[@]}")"
printf '%s' "$tracking" | jq -e '.status == "DELIVERY_FAILED" and .status != "DELIVERED" and .eta == null and .tracking == null' >/dev/null
event_count="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from delivery_provider_events where provider_event_id='$run_id-failed'")"
test "$event_count" = '1'

echo 'Stage 5 E2E passed: polygon/max-5 enforcement, scheduled READY dispatch, restart-safe provider idempotency, failure semantics, and callback deduplication.'
