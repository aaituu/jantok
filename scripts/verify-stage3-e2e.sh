#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
PHONE="${STAGE3_TEST_PHONE:-+77000000002}"
FOREIGN_PHONE="${STAGE3_FOREIGN_PHONE:-+77000000001}"
ADMIN_PHONE="${STAGE3_ADMIN_PHONE:-+77000000003}"
INBOX_TOKEN="${OTP_DEV_INBOX_TOKEN:-local-dev-inbox-token-change-before-sharing}"
WEBHOOK_SECRET="${PAYMENT_SIMULATOR_WEBHOOK_SECRET:-local-payment-webhook-secret-change-before-sharing}"
DB_CONTAINER="${STAGE3_DB_CONTAINER:-}"
device="stage3-$(date +%s)"
start_date="$(date -v+2d +%F 2>/dev/null || date -d '+2 days' +%F)"

login() {
  local phone="$1" login_device="$2" first="$3"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/request" -H 'content-type: application/json' \
    --data "{\"phone\":\"$phone\",\"deviceId\":\"$login_device\"}" >/dev/null
  local code
  code="$(curl -fsS "$API_BASE_URL/auth/otp/dev-inbox/%2B${phone#+}" -H "x-dev-inbox-token: $INBOX_TOKEN" | jq -er '.code')"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' \
    --data "{\"phone\":\"$phone\",\"deviceId\":\"$login_device\",\"deviceName\":\"Stage 3 E2E\",\"code\":\"$code\",\"firstName\":\"$first\",\"lastName\":\"E2E\"}" | jq -er '.accessToken'
}

psql_exec() {
  if [[ -n "$DB_CONTAINER" ]]; then
    docker exec -i "$DB_CONTAINER" psql -U jantok -d jantok -v ON_ERROR_STOP=1 "$@"
  else
    docker compose exec -T postgres psql -U jantok -d jantok -v ON_ERROR_STOP=1 "$@"
  fi
}

ACCESS="$(login "$PHONE" "$device-user" Customer)"
auth=(-H "authorization: Bearer $ACCESS")

member="$(curl -fsS -X POST "$API_BASE_URL/household/members" "${auth[@]}" -H 'content-type: application/json' \
  --data '{"firstName":"Payment Adult","birthDate":"1990-01-01"}' | jq -er '.id')"
catalogs="$(curl -fsS "$API_BASE_URL/catalogs/questionnaire" "${auth[@]}")"
activity="$(printf '%s' "$catalogs" | jq -er '.activityLevels[0].id')"
diet="$(printf '%s' "$catalogs" | jq -er '.dietTypes[0].id')"
curl -fsS -X PUT "$API_BASE_URL/household/members/$member/questionnaire" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"biologicalSex\":\"UNSPECIFIED\",\"heightCm\":175,\"weightKg\":70,\"activityLevelId\":\"$activity\",\"sportIntensity\":\"NONE\",\"sportHoursPerWeek\":0,\"goal\":\"MAINTAIN\",\"dietTypeId\":\"$diet\",\"allergyDeclarationStatus\":\"NONE\",\"portionPreference\":\"RECOMMENDED\",\"sportTypeIds\":[],\"allergies\":[],\"preferences\":[]}" >/dev/null
address="$(curl -fsS -X POST "$API_BASE_URL/household/addresses" "${auth[@]}" -H 'content-type: application/json' \
  --data '{"streetAddress":"Stage 3 payment street","latitude":51.1282,"longitude":71.4304}' | jq -er '.id')"

checkout_cycle() {
  local suffix="$1" bonus="$2" auto_renew="$3"
  local quote quote_id response
  quote="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/quotes" "${auth[@]}" -H 'content-type: application/json' \
    --data "{\"addressId\":\"$address\",\"startDate\":\"$start_date\",\"memberIds\":[\"$member\"],\"bonusKzt\":$bonus,\"guestDays\":0}")"
  quote_id="$(printf '%s' "$quote" | jq -er '.id')"
  response="$(curl -fsS -X POST "$API_BASE_URL/payments/checkout" "${auth[@]}" -H 'content-type: application/json' \
    --data "{\"quoteId\":\"$quote_id\",\"idempotencyKey\":\"stage3-$suffix-$device\",\"autoRenew\":$auto_renew}")"
  printf '%s' "$response" | jq -e '.status == "ACTIVE" and (.serviceDays | length) >= 30' >/dev/null
  printf '%s' "$response" | jq -r '.purchaseId + " " + .id'
}

read -r first_purchase first_subscription < <(checkout_cycle before 3000 true)
history="$(curl -fsS "$API_BASE_URL/payments/history" "${auth[@]}")"
printf '%s' "$history" | jq -e --arg id "$first_purchase" \
  '.[] | select(.id==$id) | .status == "PAID" and .attempts[0].status == "CAPTURED" and .receipts[0].fiscal == false and .receipts[0].documentSnapshot.label == "TEST RECEIPT — NOT A FISCAL RECEIPT"' >/dev/null
curl -fsS "$API_BASE_URL/payments/methods" "${auth[@]}" | jq -e \
  'length >= 1 and .[0].last4 == "4242" and .[0].mandateActive == true' >/dev/null

FOREIGN_ACCESS="$(login "$FOREIGN_PHONE" "$device-foreign" Foreign)"
foreign_auth=(-H "authorization: Bearer $FOREIGN_ACCESS")
curl -fsS -X POST "$API_BASE_URL/payments/return/$first_purchase" "${foreign_auth[@]}" | \
  jq -e '.found == false' >/dev/null
foreign_refund_status="$(curl -sS -o /tmp/jantok-stage3-foreign-refund.json -w '%{http_code}' \
  -X POST "$API_BASE_URL/payments/refunds" "${foreign_auth[@]}" -H 'content-type: application/json' \
  --data "{\"purchaseId\":\"$first_purchase\",\"idempotencyKey\":\"foreign-refund-$device\",\"reason\":\"Must not disclose another purchase\"}")"
test "$foreign_refund_status" = '404'

operation_id="$(printf '%s' "$history" | jq -er --arg id "$first_purchase" '.[] | select(.id==$id) | .attempts[0].providerReference')"
webhook_body="$(jq -cn --arg event "evt-$device" --arg operation "$operation_id" \
  '{eventId:$event,eventType:"payment.updated",operationId:$operation,occurredAt:"2099-01-01T00:00:00.000Z",status:"CAPTURED",amountKzt:27000}')"
signature="$(printf '%s' "$webhook_body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $NF}')"
curl -fsS -X POST "$API_BASE_URL/payments/webhooks/local-simulator" -H 'content-type: application/json' \
  -H "x-simulator-signature: $signature" --data "$webhook_body" | jq -e '.accepted == true' >/dev/null
curl -fsS -X POST "$API_BASE_URL/payments/webhooks/local-simulator" -H 'content-type: application/json' \
  -H "x-simulator-signature: $signature" --data "$webhook_body" | jq -e '.duplicate == true' >/dev/null

curl -fsS -X POST "$API_BASE_URL/payments/refunds" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"purchaseId\":\"$first_purchase\",\"idempotencyKey\":\"refund-before-$device\",\"reason\":\"Before first delivery\"}" | \
  jq -e '.status == "SUCCEEDED" and .kind == "BEFORE_FIRST_DELIVERY" and (.cashKzt + .bonusKzt) == 30000' >/dev/null

read -r window_purchase window_subscription < <(checkout_cycle window 0 false)
psql_exec \
  -c "update subscription_service_days set status='DELIVERED', service_date=current_date where id=(select id from subscription_service_days where subscription_id='$window_subscription' order by sequence limit 1);" >/dev/null
curl -fsS -X POST "$API_BASE_URL/payments/refunds" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"purchaseId\":\"$window_purchase\",\"idempotencyKey\":\"refund-window-$device\",\"reason\":\"Unused portion in window\"}" | \
  jq -e '.status == "SUCCEEDED" and .kind == "UNUSED_WITHIN_WINDOW" and .restoredServiceDays == 29 and .cashKzt > 0' >/dev/null

read -r admin_purchase admin_subscription < <(checkout_cycle admin 0 true)
ADMIN_ACCESS="$(login "$ADMIN_PHONE" "$device-admin" Admin)"
curl -fsS -X POST "$API_BASE_URL/staff/payments/refunds" -H "authorization: Bearer $ADMIN_ACCESS" -H 'content-type: application/json' \
  --data "{\"purchaseId\":\"$admin_purchase\",\"idempotencyKey\":\"refund-admin-$device\",\"reason\":\"JANTOK quality compensation\",\"kind\":\"ADMIN_COMPENSATION\",\"cashKzt\":1000,\"bonusKzt\":0,\"restoredServiceDays\":0}" | \
  jq -e '.status == "SUCCEEDED" and .kind == "ADMIN_COMPENSATION"' >/dev/null
curl -fsS "$API_BASE_URL/subscriptions/current" "${auth[@]}" | jq -e --arg id "$admin_subscription" \
  '.id == $id and .status == "ACTIVE"' >/dev/null

if [[ "${STAGE3_SKIP_RESTART:-0}" != "1" ]]; then
  docker compose restart backend >/dev/null
  for _ in {1..90}; do
    curl -fsS "$API_BASE_URL/health/ready" >/dev/null 2>&1 && break
    sleep 1
  done
fi
repeat="$(curl -fsS -X POST "$API_BASE_URL/payments/checkout" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"quoteId\":\"$(curl -fsS "$API_BASE_URL/payments/history" "${auth[@]}" | jq -er --arg id "$admin_purchase" '.[] | select(.id==$id) | .quoteId')\",\"idempotencyKey\":\"stage3-admin-$device\",\"autoRenew\":true}")"
test "$(printf '%s' "$repeat" | jq -er '.id')" = "$admin_subscription"

echo 'Stage 3 E2E passed: authoritative/idempotent payment, duplicate webhook, three refund policies, non-fiscal test receipt and restart-safe checkout.'
