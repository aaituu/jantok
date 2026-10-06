#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
PHONE="${STAGE1_TEST_PHONE:-+77000000001}"
INBOX_TOKEN="${OTP_DEV_INBOX_TOKEN:-local-dev-inbox-token-change-before-sharing}"
today="$(date +%F)"
selection_date="$(date -v+2d +%F 2>/dev/null || date -d '+2 days' +%F)"

json_field() { jq -er "$1"; }
request_otp() {
  local device="$1"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/request" -H 'content-type: application/json' --data "{\"phone\":\"$PHONE\",\"deviceId\":\"$device\"}" >/dev/null
  curl -fsS "$API_BASE_URL/auth/otp/dev-inbox/%2B${PHONE#+}" -H "x-dev-inbox-token: $INBOX_TOKEN" | json_field '.code'
}
verify_otp() {
  local device="$1" code="$2" names="${3:-}"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' --data "{\"phone\":\"$PHONE\",\"deviceId\":\"$device\",\"deviceName\":\"E2E $device\",\"code\":\"$code\"$names}"
}
auth() { curl -fsS "$@" -H "authorization: Bearer $ACCESS_A"; }

code_a="$(request_otp stage1-device-a)"
tokens_a="$(verify_otp stage1-device-a "$code_a" ',"firstName":"Stage","lastName":"One"')"
ACCESS_A="$(printf '%s' "$tokens_a" | json_field '.accessToken')"
REFRESH_A="$(printf '%s' "$tokens_a" | json_field '.refreshToken')"

adult="$(auth -X POST "$API_BASE_URL/household/members" -H 'content-type: application/json' --data '{"firstName":"Adult","birthDate":"1990-01-01"}' | json_field '.id')"
child="$(auth -X POST "$API_BASE_URL/household/members" -H 'content-type: application/json' --data '{"firstName":"Child","birthDate":"2018-01-01"}' | json_field '.id')"
catalogs="$(auth "$API_BASE_URL/catalogs/questionnaire")"
activity="$(printf '%s' "$catalogs" | json_field '.activityLevels[0].id')"
diet="$(printf '%s' "$catalogs" | json_field '.dietTypes[0].id')"
milk_allergen="$(printf '%s' "$catalogs" | json_field '.allergens[] | select(.code=="MILK") | .id')"

save_questionnaire() {
  local member="$1" allergies="$2" declaration="$3"
  auth -X PUT "$API_BASE_URL/household/members/$member/questionnaire" -H 'content-type: application/json' --data "{\"biologicalSex\":\"UNSPECIFIED\",\"heightCm\":160,\"weightKg\":55,\"activityLevelId\":\"$activity\",\"sportIntensity\":\"NONE\",\"sportHoursPerWeek\":0,\"goal\":\"MAINTAIN\",\"dietTypeId\":\"$diet\",\"allergyDeclarationStatus\":\"$declaration\",\"portionPreference\":\"RECOMMENDED\",\"sportTypeIds\":[],\"allergies\":$allergies,\"preferences\":[]}" >/dev/null
}
unknown_status="$(curl -sS -o /tmp/jantok-stage1-unknown-allergy.json -w '%{http_code}' -X PUT "$API_BASE_URL/household/members/$adult/questionnaire" -H 'content-type: application/json' -H "authorization: Bearer $ACCESS_A" --data "{\"biologicalSex\":\"UNSPECIFIED\",\"heightCm\":170,\"weightKg\":65,\"activityLevelId\":\"$activity\",\"sportIntensity\":\"NONE\",\"sportHoursPerWeek\":0,\"goal\":\"MAINTAIN\",\"dietTypeId\":\"$diet\",\"allergyDeclarationStatus\":\"NOT_ANSWERED\",\"portionPreference\":\"RECOMMENDED\",\"sportTypeIds\":[],\"allergies\":[],\"preferences\":[]}")"
test "$unknown_status" = 400
jq -e '.error.code == "ALLERGY_DECLARATION_REQUIRED"' /tmp/jantok-stage1-unknown-allergy.json >/dev/null
save_questionnaire "$adult" '[]' NONE
save_questionnaire "$child" "[{\"allergenId\":\"$milk_allergen\"}]" DECLARED
auth -X POST "$API_BASE_URL/household/addresses" -H 'content-type: application/json' --data '{"streetAddress":"E2E street 1","latitude":51.1282,"longitude":71.4304}' >/dev/null

docker compose restart backend >/dev/null
ready=false
for _ in {1..120}; do
  if curl -fsS "$API_BASE_URL/health/ready" >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
refreshed="$(curl -fsS -X POST "$API_BASE_URL/auth/refresh" -H 'content-type: application/json' --data "{\"refreshToken\":\"$REFRESH_A\"}")"
ACCESS_A="$(printf '%s' "$refreshed" | json_field '.accessToken')"
auth "$API_BASE_URL/household" | jq -e --arg adult "$adult" --arg child "$child" '[.members[].id] | contains([$adult, $child])' >/dev/null

code_b="$(request_otp stage1-device-b)"
tokens_b="$(verify_otp stage1-device-b "$code_b")"
ACCESS_B="$(printf '%s' "$tokens_b" | json_field '.accessToken')"
auth "$API_BASE_URL/auth/sessions" | jq -e '[.[] | select(.revokedAt == null)] | length == 2' >/dev/null

meals="$(auth "$API_BASE_URL/meals")"
milk_meal="$(printf '%s' "$meals" | json_field '.[] | select(.code=="DEMO_MILK_PORRIDGE") | .id')"
unsafe_status="$(curl -sS -o /tmp/jantok-stage1-unsafe.json -w '%{http_code}' -X POST "$API_BASE_URL/members/$child/meal-selections" -H 'content-type: application/json' -H "authorization: Bearer $ACCESS_A" --data "{\"mealId\":\"$milk_meal\",\"serviceDate\":\"$selection_date\",\"mealType\":\"BREAKFAST\",\"removedIngredientIds\":[],\"addedIngredientIds\":[],\"addonIds\":[]}")"
test "$unsafe_status" = 422
jq -e '.error.code == "UNSAFE_MEAL_SELECTION"' /tmp/jantok-stage1-unsafe.json >/dev/null
auth -X POST "$API_BASE_URL/members/$adult/meal-selections" -H 'content-type: application/json' --data "{\"mealId\":\"$milk_meal\",\"serviceDate\":\"$selection_date\",\"mealType\":\"BREAKFAST\",\"removedIngredientIds\":[],\"addedIngredientIds\":[],\"addonIds\":[]}" | jq -e '.status == "SAFE"' >/dev/null
auth -X POST "$API_BASE_URL/members/$child/recommendations" -H 'content-type: application/json' --data "{\"serviceStartDate\":\"$today\"}" | jq -e --arg milk "$milk_meal" '.ageGroupSnapshot == "AGE_6_12" and (.menuProposal | length == 30) and ((.allowedMealIds | index($milk)) == null)' >/dev/null
curl -fsS "$API_BASE_URL/household" -H "authorization: Bearer $ACCESS_B" | jq -e --arg adult "$adult" --arg child "$child" '.onboardingStep == "COMPLETED" and ([.members[].id] | contains([$adult, $child]))' >/dev/null

other_device="stage1-other-user"
curl -fsS -X POST "$API_BASE_URL/auth/otp/request" -H 'content-type: application/json' --data "{\"phone\":\"+77000000002\",\"deviceId\":\"$other_device\"}" >/dev/null
other_code="$(curl -fsS "$API_BASE_URL/auth/otp/dev-inbox/%2B77000000002" -H "x-dev-inbox-token: $INBOX_TOKEN" | json_field '.code')"
other_tokens="$(curl -fsS -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' --data "{\"phone\":\"+77000000002\",\"deviceId\":\"$other_device\",\"deviceName\":\"Ownership E2E\",\"code\":\"$other_code\",\"firstName\":\"Other\",\"lastName\":\"User\"}")"
OTHER_ACCESS="$(printf '%s' "$other_tokens" | json_field '.accessToken')"
ownership_status="$(curl -sS -o /tmp/jantok-stage1-ownership.json -w '%{http_code}' -X PUT "$API_BASE_URL/household/members/$adult/questionnaire" -H 'content-type: application/json' -H "authorization: Bearer $OTHER_ACCESS" --data "{\"biologicalSex\":\"UNSPECIFIED\",\"heightCm\":170,\"weightKg\":65,\"activityLevelId\":\"$activity\",\"sportIntensity\":\"NONE\",\"sportHoursPerWeek\":0,\"goal\":\"MAINTAIN\",\"dietTypeId\":\"$diet\",\"allergyDeclarationStatus\":\"NONE\",\"portionPreference\":\"RECOMMENDED\",\"sportTypeIds\":[],\"allergies\":[],\"preferences\":[]}")"
test "$ownership_status" = 404
jq -e '.error.code == "MEMBER_NOT_FOUND"' /tmp/jantok-stage1-ownership.json >/dev/null

reuse_otp_status="$(curl -sS -o /tmp/jantok-stage1-otp-reuse.json -w '%{http_code}' -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' --data "{\"phone\":\"$PHONE\",\"deviceId\":\"stage1-device-b\",\"code\":\"$code_b\"}")"
test "$reuse_otp_status" = 401

expired_device="stage1-expired"
expired_code="$(request_otp "$expired_device")"
docker compose exec -T postgres psql -U jantok -d jantok -v ON_ERROR_STOP=1 -c "update otp_challenges set created_at=now()-interval '10 minutes', resend_after=now()-interval '9 minutes', expires_at=now()-interval '5 minutes' where phone='$PHONE' and device_id='$expired_device';" >/dev/null
expired_status="$(curl -sS -o /tmp/jantok-stage1-otp-expired.json -w '%{http_code}' -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' --data "{\"phone\":\"$PHONE\",\"deviceId\":\"$expired_device\",\"code\":\"$expired_code\"}")"
test "$expired_status" = 401

attempt_device="stage1-attempts"
attempt_code="$(request_otp "$attempt_device")"
wrong_code=000000
test "$attempt_code" != 000000 || wrong_code=999999
for _ in {1..5}; do
  attempt_status="$(curl -sS -o /tmp/jantok-stage1-otp-attempt.json -w '%{http_code}' -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' --data "{\"phone\":\"$PHONE\",\"deviceId\":\"$attempt_device\",\"code\":\"$wrong_code\"}")"
  [[ "$attempt_status" == "401" ]]
done
attempt_limit_status="$(curl -sS -o /tmp/jantok-stage1-otp-attempt-limit.json -w '%{http_code}' -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' --data "{\"phone\":\"$PHONE\",\"deviceId\":\"$attempt_device\",\"code\":\"$attempt_code\"}")"
test "$attempt_limit_status" = 401

request_otp stage1-rate-limit-allowed >/dev/null
rate_status="$(curl -sS -o /tmp/jantok-stage1-otp-rate.json -w '%{http_code}' -X POST "$API_BASE_URL/auth/otp/request" -H 'content-type: application/json' --data "{\"phone\":\"$PHONE\",\"deviceId\":\"stage1-rate-limit-rejected\"}")"
test "$rate_status" = 429
jq -e '.error.code == "OTP_RATE_LIMITED"' /tmp/jantok-stage1-otp-rate.json >/dev/null
reuse_status="$(curl -sS -o /tmp/jantok-stage1-reuse.json -w '%{http_code}' -X POST "$API_BASE_URL/auth/refresh" -H 'content-type: application/json' --data "{\"refreshToken\":\"$REFRESH_A\"}")"
test "$reuse_status" = 401
jq -e '.error.code == "REFRESH_REUSE_DETECTED"' /tmp/jantok-stage1-reuse.json >/dev/null
curl -sS -o /dev/null -w '%{http_code}' "$API_BASE_URL/household" -H "authorization: Bearer $ACCESS_A" | grep -qx 401
curl -fsS "$API_BASE_URL/household" -H "authorization: Bearer $ACCESS_B" >/dev/null

echo 'Stage 1 E2E passed: OTP expiry/one-time/attempt/rate-limit, ownership, persistence, two devices, refresh reuse revocation, explicit allergy declaration and member-specific allergen block.'
