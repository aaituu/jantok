#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
PHONE="${STAGE2_TEST_PHONE:-+77000000002}"
INBOX_TOKEN="${OTP_DEV_INBOX_TOKEN:-local-dev-inbox-token-change-before-sharing}"
device="stage2-$(date +%s)"
start_date="$(date -v+2d +%F 2>/dev/null || date -d '+2 days' +%F)"
skip_date="$(date -v+3d +%F 2>/dev/null || date -d '+3 days' +%F)"
pause_start="$(date -v+4d +%F 2>/dev/null || date -d '+4 days' +%F)"
pause_end="$(date -v+5d +%F 2>/dev/null || date -d '+5 days' +%F)"

docker compose exec -T postgres psql -U jantok -d jantok -v ON_ERROR_STOP=1 \
  -c "update subscriptions set status='CANCELLED' where household_id in (select h.id from households h join users u on u.id=h.owner_user_id where u.phone='$PHONE') and status in ('PENDING_PAYMENT','ACTIVE','PAUSED');" >/dev/null

curl -fsS -X POST "$API_BASE_URL/auth/otp/request" -H 'content-type: application/json' \
  --data "{\"phone\":\"$PHONE\",\"deviceId\":\"$device\"}" >/dev/null
code="$(curl -fsS "$API_BASE_URL/auth/otp/dev-inbox/%2B${PHONE#+}" -H "x-dev-inbox-token: $INBOX_TOKEN" | jq -er '.code')"
tokens="$(curl -fsS -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' \
  --data "{\"phone\":\"$PHONE\",\"deviceId\":\"$device\",\"deviceName\":\"Stage 2 E2E\",\"code\":\"$code\",\"firstName\":\"Stage\",\"lastName\":\"Two\"}")"
access="$(printf '%s' "$tokens" | jq -er '.accessToken')"
auth=(-H "authorization: Bearer $access")

member="$(curl -fsS -X POST "$API_BASE_URL/household/members" "${auth[@]}" -H 'content-type: application/json' \
  --data '{"firstName":"Stage2 Adult","birthDate":"1990-01-01"}' | jq -er '.id')"
catalogs="$(curl -fsS "$API_BASE_URL/catalogs/questionnaire" "${auth[@]}")"
activity="$(printf '%s' "$catalogs" | jq -er '.activityLevels[0].id')"
diet="$(printf '%s' "$catalogs" | jq -er '.dietTypes[0].id')"
curl -fsS -X PUT "$API_BASE_URL/household/members/$member/questionnaire" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"biologicalSex\":\"UNSPECIFIED\",\"heightCm\":175,\"weightKg\":70,\"activityLevelId\":\"$activity\",\"sportIntensity\":\"NONE\",\"sportHoursPerWeek\":0,\"goal\":\"MAINTAIN\",\"dietTypeId\":\"$diet\",\"allergyDeclarationStatus\":\"NONE\",\"portionPreference\":\"RECOMMENDED\",\"sportTypeIds\":[],\"allergies\":[],\"preferences\":[]}" >/dev/null
address="$(curl -fsS -X POST "$API_BASE_URL/household/addresses" "${auth[@]}" -H 'content-type: application/json' \
  --data '{"streetAddress":"Stage 2 E2E street","latitude":51.1282,"longitude":71.4304}' | jq -er '.id')"

quote="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/quotes" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"addressId\":\"$address\",\"startDate\":\"$start_date\",\"memberIds\":[\"$member\"],\"bonusKzt\":100,\"guestDays\":1}")"
quote_id="$(printf '%s' "$quote" | jq -er '.id')"
printf '%s' "$quote" | jq -e '
  .serviceDayCount == 30 and
  (.bonusKzt >= 0 and .bonusKzt <= 100) and
  .cashKzt == (.subtotalKzt - .discountKzt - .bonusKzt) and
  (.lines | length >= 2) and
  .breakdownSnapshot.pricingRuleVersion >= 1
' >/dev/null

subscription="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/checkout" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"quoteId\":\"$quote_id\",\"idempotencyKey\":\"stage2-checkout-$device\",\"autoRenew\":true}")"
subscription_id="$(printf '%s' "$subscription" | jq -er '.id')"
printf '%s' "$subscription" | jq -e '.status == "ACTIVE" and (.serviceDays | length == 30) and (.participants | length == 1)' >/dev/null

same="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/checkout" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"quoteId\":\"$quote_id\",\"idempotencyKey\":\"stage2-checkout-$device\",\"autoRenew\":true}")"
test "$(printf '%s' "$same" | jq -er '.id')" = "$subscription_id"

extra_member="$(curl -fsS -X POST "$API_BASE_URL/household/members" "${auth[@]}" -H 'content-type: application/json' \
  --data '{"firstName":"Stage2 Added","birthDate":"2012-01-01"}' | jq -er '.id')"
member_quote="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/member-quotes" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"memberId\":\"$extra_member\",\"bonusKzt\":0}")"
printf '%s' "$member_quote" | jq -e '.breakdownSnapshot.eligibleDays > 0 and .breakdownSnapshot.cycleDays == 30 and .breakdownSnapshot.formula == "round(monthlyKzt * eligibleDays / cycleDays)"' >/dev/null
member_quote_id="$(printf '%s' "$member_quote" | jq -er '.id')"
curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/change-checkout" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"quoteId\":\"$member_quote_id\",\"idempotencyKey\":\"stage2-member-$device\"}" | jq -e '.participant.memberId != null' >/dev/null

guest_quote="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/guest-quotes" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"displayName\":\"Guest E2E\",\"serviceDates\":[\"$start_date\"],\"nutritionSnapshot\":{\"caloriesKcal\":2000},\"allergySnapshot\":{\"allergenIds\":[]},\"bonusKzt\":0}")"
guest_quote_id="$(printf '%s' "$guest_quote" | jq -er '.id')"
curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/change-checkout" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"quoteId\":\"$guest_quote_id\",\"idempotencyKey\":\"stage2-guest-$device\"}" | jq -e '.participant.guestId != null' >/dev/null
curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/auto-renew" "${auth[@]}" -H 'content-type: application/json' \
  --data '{"enabled":false}' | jq -e '.autoRenew == false' >/dev/null
addon_id="$(curl -fsS "$API_BASE_URL/addons" "${auth[@]}" | jq -er '.[] | select(.code=="DEMO_OAT_SNACK") | .id')"
addon_quote="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/standalone-addon-quotes" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"memberId\":\"$member\",\"addonId\":\"$addon_id\",\"serviceDate\":\"$start_date\",\"quantity\":1,\"bonusKzt\":0}")"
addon_quote_id="$(printf '%s' "$addon_quote" | jq -er '.id')"
curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/change-checkout" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"quoteId\":\"$addon_quote_id\",\"idempotencyKey\":\"stage2-addon-$device\"}" | jq -e '.standaloneAddonOrder.quantity == 1' >/dev/null

menu="$(curl -fsS "$API_BASE_URL/menu?from=$start_date" "${auth[@]}")"
printf '%s' "$menu" | jq -e '.days | length == 7' >/dev/null
printf '%s' "$menu" | jq -e 'all(.days[]; ([.options[] | select(.mealType=="BREAKFAST")] | length) >= 2 and ([.options[] | select(.mealType=="LUNCH")] | length) >= 2 and ([.options[] | select(.mealType=="DINNER")] | length) >= 2) and (.days[0].options[0].meal.reviews | type) == "array"' >/dev/null
meal="$(printf '%s' "$menu" | jq -er '.days[0].options[] | select(.mealType=="BREAKFAST" and .memberSafety[0].safe==true) | .mealId' | head -1)"
curl -fsS -X POST "$API_BASE_URL/members/$member/meal-selections" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"mealId\":\"$meal\",\"serviceDate\":\"$start_date\",\"mealType\":\"BREAKFAST\",\"removedIngredientIds\":[],\"addedIngredientIds\":[],\"addonIds\":[]}" \
  | jq -e '.status == "SAFE" and .recipeSnapshot.mealId != null and .priceSnapshot.mealReplacementKzt == 0' >/dev/null

curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/skip" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"serviceDate\":\"$skip_date\",\"idempotencyKey\":\"stage2-skip-$device\"}" | jq -e '.transferredFrom != null' >/dev/null
curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/skip" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"serviceDate\":\"$skip_date\",\"idempotencyKey\":\"stage2-skip-$device\"}" >/dev/null
curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/pauses" "${auth[@]}" -H 'content-type: application/json' \
  --data "{\"startDate\":\"$pause_start\",\"endDate\":\"$pause_end\",\"idempotencyKey\":\"stage2-pause-$device\"}" | jq -e '.calendarDays == 2' >/dev/null

before="$(curl -fsS "$API_BASE_URL/subscriptions/current" "${auth[@]}" | jq -c '.pricingSnapshot')"
docker compose exec -T postgres psql -U jantok -d jantok -v ON_ERROR_STOP=1 -c "insert into pricing_rule_sets (id,version,status,currency,adult_monthly_kzt,teen_monthly_kzt,child_monthly_kzt,infant_monthly_kzt,second_member_discount_bps,third_plus_discount_bps,guest_day_kzt,created_at) select gen_random_uuid(),max(version)+1,'DEMO','KZT',max(adult_monthly_kzt)+777,max(teen_monthly_kzt),max(child_monthly_kzt),max(infant_monthly_kzt),max(second_member_discount_bps),max(third_plus_discount_bps),max(guest_day_kzt),now() from pricing_rule_sets;" >/dev/null
after="$(curl -fsS "$API_BASE_URL/subscriptions/current" "${auth[@]}" | jq -c '.pricingSnapshot')"
test "$before" = "$after"
curl -fsS "$API_BASE_URL/subscriptions/current" "${auth[@]}" | jq -e '([.serviceDays[] | select(.status=="PLANNED")] | length) == 30 and (.pauses | length >= 1) and (.participants | length) == 3 and (.dailyOrders | length) == 67 and ([.dailyOrders[].lines[]] | length) >= 1 and (.standaloneAddonOrders | length) == 1' >/dev/null

echo 'Stage 2 E2E passed: quote freeze, 30 days, menu, skip/pause, member, guest, standalone add-on and auto-renew.'
