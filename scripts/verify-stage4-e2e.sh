#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
INBOX_TOKEN="${OTP_DEV_INBOX_TOKEN:-local-dev-inbox-token-change-before-sharing}"
WEBHOOK_SECRET="${PAYMENT_SIMULATOR_WEBHOOK_SECRET:-local-payment-webhook-secret-change-before-sharing}"
DB_NAME="${STAGE4_DB_NAME:-jantok}"
REFERRER_PHONE="${STAGE4_REFERRER_PHONE:-+77000000001}"
INVITEE_PHONE="${STAGE4_INVITEE_PHONE:-+77000000002}"
BONUS_PHONE="${STAGE4_BONUS_PHONE:-+77000000004}"
run_id="stage4-$(date +%s)"
start_date="$(date -v+2d +%F 2>/dev/null || date -d '+2 days' +%F)"
skip_date="$(date -v+3d +%F 2>/dev/null || date -d '+3 days' +%F)"
race_dir="$(mktemp -d "${TMPDIR:-/tmp}/jantok-stage4-race.XXXXXX")"
trap 'rm -rf "$race_dir"' EXIT

login() {
  local phone="$1" login_device="$2" first="$3" referral="${4:-}"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/request" -H 'content-type: application/json' \
    --data "{\"phone\":\"$phone\",\"deviceId\":\"$login_device\"}" >/dev/null
  local code payload
  code="$(curl -fsS "$API_BASE_URL/auth/otp/dev-inbox/%2B${phone#+}" -H "x-dev-inbox-token: $INBOX_TOKEN" | jq -er '.code')"
  payload="$(jq -cn --arg phone "$phone" --arg device "$login_device" --arg code "$code" --arg first "$first" --arg referral "$referral" \
    '{phone:$phone,deviceId:$device,deviceName:"Stage 4 E2E",code:$code,firstName:$first,lastName:"E2E"} + (if $referral=="" then {} else {referralCode:$referral} end)')"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' --data "$payload" | jq -er '.accessToken'
}

create_checkout_context() {
  local token="$1" label="$2"
  local member address catalogs activity diet
  member="$(curl -fsS -X POST "$API_BASE_URL/household/members" -H "authorization: Bearer $token" -H 'content-type: application/json' \
    --data "{\"firstName\":\"$label\",\"birthDate\":\"1990-01-01\"}" | jq -er '.id')"
  catalogs="$(curl -fsS "$API_BASE_URL/catalogs/questionnaire" -H "authorization: Bearer $token")"
  activity="$(printf '%s' "$catalogs" | jq -er '.activityLevels[0].id')"
  diet="$(printf '%s' "$catalogs" | jq -er '.dietTypes[0].id')"
  curl -fsS -X PUT "$API_BASE_URL/household/members/$member/questionnaire" -H "authorization: Bearer $token" -H 'content-type: application/json' \
    --data "{\"biologicalSex\":\"UNSPECIFIED\",\"heightCm\":175,\"weightKg\":70,\"activityLevelId\":\"$activity\",\"sportIntensity\":\"NONE\",\"sportHoursPerWeek\":0,\"goal\":\"MAINTAIN\",\"dietTypeId\":\"$diet\",\"allergyDeclarationStatus\":\"NONE\",\"portionPreference\":\"RECOMMENDED\",\"sportTypeIds\":[],\"allergies\":[],\"preferences\":[]}" >/dev/null
  address="$(curl -fsS -X POST "$API_BASE_URL/household/addresses" -H "authorization: Bearer $token" -H 'content-type: application/json' \
    --data "{\"streetAddress\":\"$label Stage 4 street\",\"latitude\":51.1282,\"longitude\":71.4304}" | jq -er '.id')"
  printf '%s %s\n' "$member" "$address"
}

REFERRER_ACCESS="$(login "$REFERRER_PHONE" "$run_id-referrer" Referrer)"
referral_code="$(curl -fsS "$API_BASE_URL/loyalty/club" -H "authorization: Bearer $REFERRER_ACCESS" | jq -er '.referralCode')"

INVITEE_ACCESS="$(login "$INVITEE_PHONE" "$run_id-invitee" Invitee "$referral_code")"
read -r invitee_member invitee_address < <(create_checkout_context "$INVITEE_ACCESS" Invitee)
invitee_quote="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/quotes" -H "authorization: Bearer $INVITEE_ACCESS" -H 'content-type: application/json' \
  --data "{\"addressId\":\"$invitee_address\",\"startDate\":\"$start_date\",\"memberIds\":[\"$invitee_member\"],\"bonusKzt\":0,\"promoCode\":\"DEMO10\"}")"
printf '%s' "$invitee_quote" | jq -e '.subtotalKzt == 30000 and .discountKzt == 3000 and .bonusKzt == 0 and .cashKzt == 27000' >/dev/null
invitee_quote_id="$(printf '%s' "$invitee_quote" | jq -er '.id')"
invitee_subscription="$(curl -fsS -X POST "$API_BASE_URL/payments/checkout" -H "authorization: Bearer $INVITEE_ACCESS" -H 'content-type: application/json' \
  --data "{\"quoteId\":\"$invitee_quote_id\",\"idempotencyKey\":\"$run_id-invitee-checkout\",\"autoRenew\":false}")"
printf '%s' "$invitee_subscription" | jq -e '.status == "ACTIVE" and (.serviceDays | length) == 30' >/dev/null

history="$(curl -fsS "$API_BASE_URL/payments/history" -H "authorization: Bearer $INVITEE_ACCESS")"
operation_id="$(printf '%s' "$history" | jq -er '.[0].attempts[0].providerReference')"
webhook_body="$(jq -cn --arg event "$run_id-event" --arg operation "$operation_id" \
  '{eventId:$event,eventType:"payment.updated",operationId:$operation,occurredAt:"2099-01-01T00:00:00.000Z",status:"CAPTURED",amountKzt:27000}')"
signature="$(printf '%s' "$webhook_body" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $NF}')"
curl -fsS -X POST "$API_BASE_URL/payments/webhooks/local-simulator" -H 'content-type: application/json' -H "x-simulator-signature: $signature" --data "$webhook_body" | jq -e '.accepted == true' >/dev/null
curl -fsS -X POST "$API_BASE_URL/payments/webhooks/local-simulator" -H 'content-type: application/json' -H "x-simulator-signature: $signature" --data "$webhook_body" | jq -e '.duplicate == true' >/dev/null

referrer_club="$(curl -fsS "$API_BASE_URL/loyalty/club" -H "authorization: Bearer $REFERRER_ACCESS")"
printf '%s' "$referrer_club" | jq -e '([.invitedFriends[] | select(.status=="QUALIFIED")] | length) == 1 and ([.history[] | select(.sourceKey | startswith("referral:"))] | length) == 1' >/dev/null
invitee_club="$(curl -fsS "$API_BASE_URL/loyalty/club" -H "authorization: Bearer $INVITEE_ACCESS")"
printf '%s' "$invitee_club" | jq -e '([.history[] | select(.sourceKey | startswith("welcome:"))] | length) == 1' >/dev/null

# Two different households compete for the final global promotion slot. The
# promotion-scoped transaction lock must allow exactly one reservation.
PROMO_RACER_ACCESS="$(login '+77000000003' "$run_id-promo-racer" PromoRacer)"
read -r referrer_member referrer_address < <(create_checkout_context "$REFERRER_ACCESS" Referrer)
read -r promo_racer_member promo_racer_address < <(create_checkout_context "$PROMO_RACER_ACCESS" PromoRacer)
race_promo="RACE${run_id//[^0-9]/}"
docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "insert into promo_codes (code,mechanic,value,status,total_use_limit,per_household_use_limit,first_subscription_only,min_subtotal_kzt,applicable_operations,applicable_product_codes,compatible_codes) values ('$race_promo','PERCENT_DISCOUNT',1000,'DEMO',1,1,false,0,'[\"SUBSCRIPTION\"]'::jsonb,'[]'::jsonb,'[]'::jsonb);" >/dev/null
(
  curl -sS -o "$race_dir/promo-a.json" -w '%{http_code}' -X POST "$API_BASE_URL/subscriptions/quotes" \
    -H "authorization: Bearer $REFERRER_ACCESS" -H 'content-type: application/json' \
    --data "{\"addressId\":\"$referrer_address\",\"startDate\":\"$start_date\",\"memberIds\":[\"$referrer_member\"],\"bonusKzt\":0,\"promoCode\":\"$race_promo\"}" \
    >"$race_dir/promo-a.status"
) &
promo_pid_a=$!
(
  curl -sS -o "$race_dir/promo-b.json" -w '%{http_code}' -X POST "$API_BASE_URL/subscriptions/quotes" \
    -H "authorization: Bearer $PROMO_RACER_ACCESS" -H 'content-type: application/json' \
    --data "{\"addressId\":\"$promo_racer_address\",\"startDate\":\"$start_date\",\"memberIds\":[\"$promo_racer_member\"],\"bonusKzt\":0,\"promoCode\":\"$race_promo\"}" \
    >"$race_dir/promo-b.status"
) &
promo_pid_b=$!
wait "$promo_pid_a" "$promo_pid_b"
test "$(grep -l '^201$' "$race_dir"/promo-?.status | wc -l | tr -d ' ')" = '1'
test "$(grep -l '^422$' "$race_dir"/promo-?.status | wc -l | tr -d ' ')" = '1'
if [[ "$(cat "$race_dir/promo-a.status")" = '201' ]]; then
  promo_winner_access="$REFERRER_ACCESS"
  promo_winner_member="$referrer_member"
  promo_winner_address="$referrer_address"
  promo_winner_file="$race_dir/promo-a.json"
else
  promo_winner_access="$PROMO_RACER_ACCESS"
  promo_winner_member="$promo_racer_member"
  promo_winner_address="$promo_racer_address"
  promo_winner_file="$race_dir/promo-b.json"
fi
promo_winner_quote="$(jq -er '.id' "$promo_winner_file")"
docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "update price_quotes set status='CANCELLED' where id='$promo_winner_quote';" >/dev/null
curl -fsS -X POST "$API_BASE_URL/subscriptions/quotes" -H "authorization: Bearer $promo_winner_access" -H 'content-type: application/json' \
  --data "{\"addressId\":\"$promo_winner_address\",\"startDate\":\"$start_date\",\"memberIds\":[\"$promo_winner_member\"],\"bonusKzt\":0,\"promoCode\":\"$race_promo\"}" | jq -e '.discountKzt == 3000' >/dev/null
test "$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from promo_reservations pr join promo_codes pc on pc.id=pr.promo_code_id where pc.code='$race_promo' and pr.status='RESERVED'")" = '1'
test "$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from promo_reservations pr join promo_codes pc on pc.id=pr.promo_code_id where pc.code='$race_promo' and pr.status='RELEASED'")" = '1'

BONUS_ACCESS="$(login "$BONUS_PHONE" "$run_id-bonus" Bonus)"
read -r bonus_member bonus_address < <(create_checkout_context "$BONUS_ACCESS" Bonus)
docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "insert into bonus_ledger_entries (id,household_id,idempotency_key,type,amount_kzt,reason,source_key,created_at) select gen_random_uuid(),h.id,'$run_id-seed','CREDIT',50000,'Stage 4 E2E seed','test:$run_id',now() from households h join users u on u.id=h.owner_user_id where u.phone='$BONUS_PHONE';" >/dev/null

bonus_quote="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/quotes" -H "authorization: Bearer $BONUS_ACCESS" -H 'content-type: application/json' \
  --data "{\"addressId\":\"$bonus_address\",\"startDate\":\"$start_date\",\"memberIds\":[\"$bonus_member\"],\"bonusKzt\":50000,\"promoCode\":\"DEMO10\"}")"
printf '%s' "$bonus_quote" | jq -e '.subtotalKzt == 30000 and .discountKzt == 3000 and .bonusKzt == 27000 and .cashKzt == 0' >/dev/null
bonus_quote_id="$(printf '%s' "$bonus_quote" | jq -er '.id')"
# Two devices deliberately submit different idempotency keys for the same
# bonus-backed quote. Exactly one purchase may consume its hold.
for contender in a b; do
  (
    curl -sS -o "$race_dir/bonus-$contender.json" -w '%{http_code}' -X POST "$API_BASE_URL/payments/checkout" \
      -H "authorization: Bearer $BONUS_ACCESS" -H 'content-type: application/json' \
      --data "{\"quoteId\":\"$bonus_quote_id\",\"idempotencyKey\":\"$run_id-bonus-checkout-$contender\",\"autoRenew\":false}" \
      >"$race_dir/bonus-$contender.status"
  ) &
done
wait
test "$(grep -l '^201$' "$race_dir"/bonus-?.status | wc -l | tr -d ' ')" = '1'
test "$(grep -l '^409$' "$race_dir"/bonus-?.status | wc -l | tr -d ' ')" = '1'
bonus_subscription="$(jq -sc '[.[] | select(.status == "ACTIVE")][0]' "$race_dir"/bonus-?.json)"
printf '%s' "$bonus_subscription" | jq -e '.status == "ACTIVE"' >/dev/null
test "$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from purchases where quote_id='$bonus_quote_id'")" = '1'
bonus_subscription_id="$(printf '%s' "$bonus_subscription" | jq -er '.id')"
curl -fsS "$API_BASE_URL/payments/history" -H "authorization: Bearer $BONUS_ACCESS" | jq -e '.[0].cashKzt == 0 and (.[0].attempts | length) == 0' >/dev/null
curl -fsS "$API_BASE_URL/loyalty/club" -H "authorization: Bearer $BONUS_ACCESS" | jq -e '([.history[] | select(.sourceKey | startswith("welcome:"))] | length) == 0' >/dev/null

participant_id="$(printf '%s' "$bonus_subscription" | jq -er '.participants[0].id')"
addon_id="$(curl -fsS "$API_BASE_URL/loyalty/addons" -H "authorization: Bearer $BONUS_ACCESS" | jq -er '.[] | select(.code=="DEMO_OAT_SNACK") | .id')"
plan="$(curl -fsS -X POST "$API_BASE_URL/payments/addons/recurring" -H "authorization: Bearer $BONUS_ACCESS" -H 'content-type: application/json' \
  --data "{\"subscriptionId\":\"$bonus_subscription_id\",\"participantId\":\"$participant_id\",\"addonId\":\"$addon_id\",\"quantityPerDay\":1,\"bonusKzt\":1000,\"idempotencyKey\":\"$run_id-addon\"}")"
printf '%s' "$plan" | jq -e '.paidUnits == 30 and .remainingUnits == 30 and .bonusKzt == 1000 and .cashKzt == 1700 and .paymentStatus == "CAPTURED" and (.allocations | length) == 30' >/dev/null
plan_id="$(printf '%s' "$plan" | jq -er '.id')"
repeat_plan="$(curl -fsS -X POST "$API_BASE_URL/payments/addons/recurring" -H "authorization: Bearer $BONUS_ACCESS" -H 'content-type: application/json' \
  --data "{\"subscriptionId\":\"$bonus_subscription_id\",\"participantId\":\"$participant_id\",\"addonId\":\"$addon_id\",\"quantityPerDay\":1,\"bonusKzt\":1000,\"idempotencyKey\":\"$run_id-addon\"}")"
test "$(printf '%s' "$repeat_plan" | jq -er '.id')" = "$plan_id"
curl -fsS -X POST "$API_BASE_URL/subscriptions/$bonus_subscription_id/skip" -H "authorization: Bearer $BONUS_ACCESS" -H 'content-type: application/json' \
  --data "{\"serviceDate\":\"$skip_date\",\"idempotencyKey\":\"$run_id-skip\"}" >/dev/null
curl -fsS "$API_BASE_URL/subscriptions/current" -H "authorization: Bearer $BONUS_ACCESS" | jq -e '(.recurringAddonPlans[0].allocations | length) == 31 and ([.recurringAddonPlans[0].allocations[] | select(.status=="MOVED")] | length) == 1' >/dev/null
addon_refund="$(curl -fsS -X POST "$API_BASE_URL/payments/addons/refunds" -H "authorization: Bearer $BONUS_ACCESS" -H 'content-type: application/json' \
  --data "{\"planId\":\"$plan_id\",\"units\":2,\"idempotencyKey\":\"$run_id-addon-refund\",\"reason\":\"Partial recurring add-on cancellation\"}")"
printf '%s' "$addon_refund" | jq -e '.status == "SUCCEEDED" and .units == 2 and .finalizedAt != null' >/dev/null
repeat_refund="$(curl -fsS -X POST "$API_BASE_URL/payments/addons/refunds" -H "authorization: Bearer $BONUS_ACCESS" -H 'content-type: application/json' \
  --data "{\"planId\":\"$plan_id\",\"units\":2,\"idempotencyKey\":\"$run_id-addon-refund\",\"reason\":\"Partial recurring add-on cancellation\"}")"
test "$(printf '%s' "$repeat_refund" | jq -er '.id')" = "$(printf '%s' "$addon_refund" | jq -er '.id')"
curl -fsS "$API_BASE_URL/subscriptions/current" -H "authorization: Bearer $BONUS_ACCESS" | jq -e '.recurringAddonPlans[0].remainingUnits == 28 and ([.recurringAddonPlans[0].allocations[] | select(.status=="CANCELLED")] | map(.quantity) | add) == 2' >/dev/null

echo 'Stage 4 E2E passed: referral qualification and webhook dedupe, promo→bonus→cash, 100% bonus checkout without bank attempt, CLUB wallet, recurring add-on transfer and partial refund.'
