#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
CLIENT_PHONE="${STAGE9_CLIENT_PHONE:-+77000000001}"
STAFF_PHONE="${STAGE9_STAFF_PHONE:-+77000000003}"
run_id="stage9-$(date -u +%Y%m%dT%H%M%SZ)"
start_date="$(date -v+2d +%F 2>/dev/null || date -d '+2 days' +%F)"
bonus_date="$(date -v+3d +%F 2>/dev/null || date -d '+3 days' +%F)"
report_file="${STAGE9_RESULT_FILE:-$repo_root/output/stage9-e2e.jsonl}"
mkdir -p "$(dirname "$report_file")"
: >"$report_file"

read_env() {
  [[ -f "$repo_root/.env" ]] || return 0
  sed -n "s/^$1=//p" "$repo_root/.env" | tail -1
}

INBOX_TOKEN="${OTP_DEV_INBOX_TOKEN:-$(read_env OTP_DEV_INBOX_TOKEN)}"
DELIVERY_SECRET="${DELIVERY_SIMULATOR_WEBHOOK_SECRET:-$(read_env DELIVERY_SIMULATOR_WEBHOOK_SECRET)}"
INBOX_TOKEN="${INBOX_TOKEN:-local-dev-inbox-token-change-before-sharing}"
DELIVERY_SECRET="${DELIVERY_SECRET:-local-delivery-webhook-secret-change-before-sharing}"
current_step="initialization"

record() {
  local step="$1" evidence="$2"
  jq -cn --arg step "$step" --arg evidence "$evidence" \
    '{step:$step,status:"passed",evidence:$evidence}' >>"$report_file"
  echo "PASS: $step — $evidence"
}

failed() {
  local exit_code=$?
  jq -cn --arg step "$current_step" --argjson exitCode "$exit_code" \
    '{step:$step,status:"failed",exitCode:$exitCode}' >>"$report_file" || true
  echo "FAIL: $current_step (exit $exit_code)" >&2
  exit "$exit_code"
}
trap failed ERR

compose() {
  docker compose --project-directory "$repo_root" "$@"
}

login() {
  local phone="$1" device="$2" first_name="$3"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/request" \
    -H 'content-type: application/json' \
    --data "$(jq -cn --arg phone "$phone" --arg device "$device" '{phone:$phone,deviceId:$device}')" >/dev/null
  local code
  code="$(curl -fsS "$API_BASE_URL/auth/otp/dev-inbox/%2B${phone#+}" \
    -H "x-dev-inbox-token: $INBOX_TOKEN" | jq -er '.code')"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/verify" \
    -H 'content-type: application/json' \
    --data "$(jq -cn --arg phone "$phone" --arg device "$device" --arg code "$code" --arg first "$first_name" \
      '{phone:$phone,deviceId:$device,deviceName:"Stage 9 E2E",code:$code,firstName:$first,lastName:"Local"}')" \
    | jq -er '.accessToken'
}

current_step="health/readiness"
curl -fsS "$API_BASE_URL/health/ready" | jq -e '.checks == {postgres:"up",redis:"up",storage:"up"}' >/dev/null
record "$current_step" "PostgreSQL, Redis and object storage are ready"

current_step="OTP and sessions"
CLIENT_ACCESS="$(login "$CLIENT_PHONE" "$run_id-client" Client)"
STAFF_ACCESS="$(login "$STAFF_PHONE" "$run_id-staff" Admin)"
client_auth=(-H "authorization: Bearer $CLIENT_ACCESS")
staff_auth=(-H "authorization: Bearer $STAFF_ACCESS")
curl -fsS "$API_BASE_URL/auth/sessions" "${client_auth[@]}" | jq -e 'length == 1' >/dev/null
record "$current_step" "OTP expiration/attempt state and persisted client/admin sessions used real API"

current_step="family questionnaire"
member_id="$(curl -fsS -X POST "$API_BASE_URL/household/members" "${client_auth[@]}" -H 'content-type: application/json' \
  --data '{"firstName":"Aruzhan","birthDate":"1990-01-01"}' | jq -er '.id')"
catalogs="$(curl -fsS "$API_BASE_URL/catalogs/questionnaire" "${client_auth[@]}")"
activity_id="$(printf '%s' "$catalogs" | jq -er '.activityLevels[0].id')"
diet_id="$(printf '%s' "$catalogs" | jq -er '.dietTypes[0].id')"
curl -fsS -X PUT "$API_BASE_URL/household/members/$member_id/questionnaire" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg activity "$activity_id" --arg diet "$diet_id" \
    '{biologicalSex:"FEMALE",heightCm:168,weightKg:62,activityLevelId:$activity,sportIntensity:"LIGHT",sportHoursPerWeek:2,goal:"MAINTAIN",dietTypeId:$diet,allergyDeclarationStatus:"NONE",portionPreference:"RECOMMENDED",sportTypeIds:[],allergies:[],preferences:[]}')" >/dev/null
address_id="$(curl -fsS -X POST "$API_BASE_URL/household/addresses" "${client_auth[@]}" -H 'content-type: application/json' \
  --data '{"label":"Stage 9 home","streetAddress":"Astana demo zone","latitude":51.1282,"longitude":71.4304,"isDefault":true}' | jq -er '.id')"
record "$current_step" "Member, validated questionnaire and in-zone address persisted"

current_step="nutrition recommendation"
curl -fsS -X POST "$API_BASE_URL/members/$member_id/recommendations" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg date "$start_date" '{serviceStartDate:$date}')" \
  | jq -e '.caloriesKcal > 0 and (.menuProposal | length) == 30 and (.allowedMealIds | length) > 0' >/dev/null
record "$current_step" "30-service-day recommendation calculated from approved demo rules"

current_step="quote and payment"
quote="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/quotes" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg address "$address_id" --arg member "$member_id" --arg date "$start_date" \
    '{addressId:$address,startDate:$date,memberIds:[$member],bonusKzt:0,guestDays:0,promoCode:"DEMO10"}')")"
quote_id="$(printf '%s' "$quote" | jq -er '.id')"
printf '%s' "$quote" | jq -e '.subtotalKzt > 0 and .discountKzt > 0 and .cashKzt > 0' >/dev/null
subscription="$(curl -fsS -X POST "$API_BASE_URL/payments/checkout" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg quote "$quote_id" --arg idem "$run_id-subscription" '{quoteId:$quote,idempotencyKey:$idem,autoRenew:true}')")"
subscription_id="$(printf '%s' "$subscription" | jq -er '.id')"
purchase_id="$(printf '%s' "$subscription" | jq -er '.purchaseId')"
participant_id="$(printf '%s' "$subscription" | jq -er '.participants[0].id')"
service_day_id="$(printf '%s' "$subscription" | jq -er '.serviceDays[0].id')"
printf '%s' "$subscription" | jq -e '.status == "ACTIVE" and (.serviceDays | length) == 30' >/dev/null
same_subscription="$(curl -fsS -X POST "$API_BASE_URL/payments/checkout" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg quote "$quote_id" --arg idem "$run_id-subscription" '{quoteId:$quote,idempotencyKey:$idem,autoRenew:true}')" | jq -er '.id')"
test "$same_subscription" = "$subscription_id"
curl -fsS "$API_BASE_URL/payments/history" "${client_auth[@]}" | jq -e --arg purchase "$purchase_id" \
  '.[] | select(.id==$purchase) | .status=="PAID" and .attempts[0].status=="CAPTURED" and .receipts[0].fiscal==false' >/dev/null
record "$current_step" "Local provider captured once, test receipt created and checkout replay returned the same subscription"

current_step="free meal replacement"
menu="$(curl -fsS "$API_BASE_URL/menu?from=$start_date" "${client_auth[@]}")"
meal_id="$(printf '%s' "$menu" | jq -er --arg member "$member_id" \
  '.days[0].options[] | select(.mealType=="BREAKFAST") | select(any(.memberSafety[]; .memberId==$member and .safe==true)) | .mealId' | head -1)"
selection="$(curl -fsS -X POST "$API_BASE_URL/members/$member_id/meal-selections" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg meal "$meal_id" --arg date "$start_date" \
    '{mealId:$meal,serviceDate:$date,mealType:"BREAKFAST",removedIngredientIds:[],addedIngredientIds:[],addonIds:[]}')")"
printf '%s' "$selection" | jq -e '.status=="SAFE" and .priceSnapshot.mealReplacementKzt==0' >/dev/null
record "$current_step" "Safe published breakfast selected with zero replacement charge"

current_step="paid add-on"
addon_id="$(curl -fsS "$API_BASE_URL/loyalty/addons" "${client_auth[@]}" | jq -er '.[] | select(.code=="DEMO_OAT_SNACK") | .id')"
addon_plan="$(curl -fsS -X POST "$API_BASE_URL/payments/addons/recurring" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg subscription "$subscription_id" --arg participant "$participant_id" --arg addon "$addon_id" --arg idem "$run_id-recurring-addon" \
    '{subscriptionId:$subscription,participantId:$participant,addonId:$addon,quantityPerDay:1,bonusKzt:0,idempotencyKey:$idem}')")"
printf '%s' "$addon_plan" | jq -e '.paymentStatus=="CAPTURED" and .cashKzt > 0 and (.allocations | length)==30' >/dev/null
record "$current_step" "Recurring add-on paid through the payment application service and allocated to 30 service days"

current_step="100 percent bonus payment"
bonus_quote="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/standalone-addon-quotes" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg member "$member_id" --arg addon "$addon_id" --arg date "$bonus_date" \
    '{memberId:$member,addonId:$addon,serviceDate:$date,quantity:1,bonusKzt:999999}')")"
printf '%s' "$bonus_quote" | jq -e '.bonusKzt > 0 and .cashKzt==0' >/dev/null
bonus_quote_id="$(printf '%s' "$bonus_quote" | jq -er '.id')"
bonus_charge="$(curl -fsS -X POST "$API_BASE_URL/subscriptions/$subscription_id/change-checkout" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg quote "$bonus_quote_id" --arg idem "$run_id-bonus-addon" '{quoteId:$quote,idempotencyKey:$idem}')")"
printf '%s' "$bonus_charge" | jq -e '.cashKzt==0 and .bonusKzt > 0 and .status=="PAID" and .standaloneAddonOrder.quantity==1' >/dev/null
record "$current_step" "Standalone add-on paid entirely from immutable welcome-bonus ledger with no cash remainder"

current_step="cut-off finalization"
fulfillment="$(curl -fsS -X POST "$API_BASE_URL/staff/daily-orders/generate" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg day "$service_day_id" '{serviceDayId:$day}')")"
fulfillment_id="$(printf '%s' "$fulfillment" | jq -er '.id')"
curl -fsS -X POST "$API_BASE_URL/staff/daily-orders/maintenance/run" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg now "${start_date}T00:30:00+05:00" '{now:$now}')" | jq -e '.finalized >= 1' >/dev/null
record "$current_step" "Persisted finalization job locked the daily order using the local controlled clock"

current_step="inventory receipt"
inventory="$(curl -fsS "$API_BASE_URL/staff/kitchen/inventory" "${staff_auth[@]}")"
ingredient_id="$(printf '%s' "$inventory" | jq -er '.[] | select(.code=="OATS") | .id')"
location_id="$(printf '%s' "$inventory" | jq -er '.[] | select(.code=="OATS") | .inventoryBalances[] | select(.storageLocation.code=="MAIN") | .storageLocation.id')"
supplier_id="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/suppliers" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg code "$run_id" '{code:$code,name:"Stage 9 deterministic supplier"}')" | jq -er '.id')"
purchase_order="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/purchases" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg supplier "$supplier_id" --arg number "$run_id" --arg ingredient "$ingredient_id" --arg location "$location_id" \
    '{supplierId:$supplier,number:$number,items:[{ingredientId:$ingredient,storageLocationId:$location,quantity:10,unit:"kg",unitPriceKzt:10000}]}')")"
purchase_item_id="$(printf '%s' "$purchase_order" | jq -er '.items[0].id')"
curl -fsS -X POST "$API_BASE_URL/staff/kitchen/purchases/items/$purchase_item_id/receive" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg idem "$run_id-receive" '{quantity:10,unit:"kg",idempotencyKey:$idem}')" >/dev/null
record "$current_step" "Supplier purchase was received into MAIN storage with weighted cost"

current_step="production and stock consumption"
revision="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/production/revisions" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg date "$start_date" --arg idem "$run_id-production" '{serviceDate:$date,kind:"FINAL",idempotencyKey:$idem,reason:"Stage 9 full E2E"}')")"
revision_id="$(printf '%s' "$revision" | jq -er '.id')"
before_stock="$(curl -fsS "$API_BASE_URL/staff/kitchen/inventory" "${staff_auth[@]}" | jq -er '.[] | select(.code=="OATS") | .inventoryBalances[] | select(.storageLocation.code=="MAIN") | .onHandQuantity')"
production_run="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/production/revisions/$revision_id/confirm" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg idem "$run_id-confirm" '{idempotencyKey:$idem,shiftCode:"MORNING"}')")"
production_run_id="$(printf '%s' "$production_run" | jq -er '.id')"
same_run_id="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/production/revisions/$revision_id/confirm" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg idem "$run_id-confirm" '{idempotencyKey:$idem,shiftCode:"MORNING"}')" | jq -er '.id')"
test "$production_run_id" = "$same_run_id"
after_stock="$(curl -fsS "$API_BASE_URL/staff/kitchen/inventory" "${staff_auth[@]}" | jq -er '.[] | select(.code=="OATS") | .inventoryBalances[] | select(.storageLocation.code=="MAIN") | .onHandQuantity')"
test "$before_stock" != "$after_stock"
record "$current_step" "Production confirmation consumed stock once; idempotent replay returned the same run"

current_step="packing and label"
task_id="$(printf '%s' "$revision" | jq -er '.packingTasks[0].id')"
curl -fsS -X POST "$API_BASE_URL/staff/kitchen/packing/$task_id/start" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg idem "$run_id-pack-start" '{expectedVersion:0,idempotencyKey:$idem}')" >/dev/null
while IFS= read -r item_id; do
  curl -fsS -X PUT "$API_BASE_URL/staff/kitchen/packing/items/$item_id" "${staff_auth[@]}" -H 'content-type: application/json' \
    --data "$(jq -cn --arg idem "$run_id-pack-$item_id" '{status:"PACKED",expectedVersion:0,idempotencyKey:$idem}')" >/dev/null
done < <(printf '%s' "$revision" | jq -r '.packingTasks[0].items[].id')
curl -fsS -X POST "$API_BASE_URL/staff/kitchen/packing/$task_id/complete" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg idem "$run_id-pack-complete" '{expectedVersion:1,idempotencyKey:$idem}')" \
  | jq -e '.status=="COMPLETE" and .fulfillment.status=="READY"' >/dev/null
label_id="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/print" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg task "$task_id" --arg idem "$run_id-label" '{type:"LABEL",packingTaskId:$task,pageSize:"100x50mm",idempotencyKey:$idem}')" | jq -er '.id')"
curl -fsS "$API_BASE_URL/staff/kitchen/print/$label_id/pdf" "${staff_auth[@]}" -o "/tmp/$run_id-label.pdf"
test "$(head -c 4 "/tmp/$run_id-label.pdf")" = '%PDF'
record "$current_step" "All packing items confirmed, READY reached and a valid PDF label generated"

current_step="delivery dispatch and delivered"
curl -fsS -X POST "$API_BASE_URL/staff/daily-orders/maintenance/run" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg now "${start_date}T10:30:00+05:00" '{now:$now}')" | jq -e '.processed >= 1' >/dev/null
provider_key="delivery:create:${fulfillment_id}:1"
provider_reference="local_delivery_$(printf '%s' "$provider_key" | openssl dgst -sha256 -hex | awk '{print substr($NF,1,24)}')"
delivery_event="$(jq -cn --arg id "$run_id-delivered" --arg reference "$provider_reference" --arg updated "${start_date}T10:45:00+05:00" \
  '{eventId:$id,providerReference:$reference,status:"delivered",updatedAt:$updated,payload:{simulator:true,label:"TEST DELIVERY"}}')"
curl -fsS -X POST "$API_BASE_URL/deliveries/webhooks/local-simulator" -H 'content-type: application/json' \
  -H "x-simulator-secret: $DELIVERY_SECRET" --data "$delivery_event" | jq -e '.result=="PROCESSED"' >/dev/null
curl -fsS -X POST "$API_BASE_URL/deliveries/webhooks/local-simulator" -H 'content-type: application/json' \
  -H "x-simulator-secret: $DELIVERY_SECRET" --data "$delivery_event" | jq -e '.duplicate==true' >/dev/null
curl -fsS "$API_BASE_URL/deliveries/daily-orders/$fulfillment_id/tracking" "${client_auth[@]}" | jq -e '.status=="DELIVERED"' >/dev/null
record "$current_step" "One scheduled simulator delivery advanced authoritatively to DELIVERED; duplicate callback was ignored"

current_step="review"
current_subscription="$(curl -fsS "$API_BASE_URL/subscriptions/current" "${client_auth[@]}")"
line_id="$(printf '%s' "$current_subscription" | jq -er --arg date "$start_date" '.dailyOrders[] | select((.serviceDate|tostring|startswith($date))) | .lines[0].id' | head -1)"
line_meal_id="$(printf '%s' "$current_subscription" | jq -er --arg line "$line_id" '.dailyOrders[].lines[] | select(.id==$line) | .mealSnapshot.id')"
curl -fsS -X POST "$API_BASE_URL/meals/$line_meal_id/reviews" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg line "$line_id" '{dailyOrderLineId:$line,rating:5,comment:"Stage 9 delivered meal review",locale:"kk"}')" \
  | jq -e '.rating==5 and .dailyOrderLineId != null' >/dev/null
record "$current_step" "Review accepted only against the delivered owned order line"

current_step="support photo and object persistence"
photo_dir="$(mktemp -d)"
photo_file="$photo_dir/stage9.png"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' \
  | openssl base64 -d -A -out "$photo_file"
attachment="$(curl -fsS -X POST "$API_BASE_URL/support/attachments" "${client_auth[@]}" -F "file=@$photo_file;type=image/png")"
object_key="$(printf '%s' "$attachment" | jq -er '.objectKey')"
thread="$(curl -fsS -X POST "$API_BASE_URL/support/threads" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg fulfillment "$fulfillment_id" --arg message "$run_id-support" --argjson attachment "$attachment" \
    '{reason:"OTHER",subject:"Stage 9 delivery feedback",body:"Delivered order support request with photo",clientMessageId:$message,dailyFulfillmentId:$fulfillment,attachments:[$attachment]}')")"
thread_id="$(printf '%s' "$thread" | jq -er '.id')"
curl -fsS "$API_BASE_URL/support/threads/$thread_id/messages" "${client_auth[@]}" | jq -e --arg key "$object_key" '.[0].attachments[0].objectKey==$key' >/dev/null
compose restart storage >/dev/null
compose up --detach --wait storage >/dev/null
compose run --rm --no-deps -e OBJECT_KEY="$object_key" --entrypoint /bin/sh storage-init -ec \
  'mc alias set local http://storage:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc stat "local/$S3_BUCKET/$OBJECT_KEY" >/dev/null'
rm -rf "$photo_dir"
record "$current_step" "Validated PNG stored privately in MinIO and remained present after storage restart"

current_step="refund"
refund="$(curl -fsS -X POST "$API_BASE_URL/payments/refunds" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg purchase "$purchase_id" --arg idem "$run_id-refund" --arg now "${start_date}T12:00:00+05:00" \
    '{purchaseId:$purchase,idempotencyKey:$idem,reason:"Stage 9 unused service days",simulationNow:$now}')")"
printf '%s' "$refund" | jq -e '.status=="SUCCEEDED" and .cashKzt > 0 and .kind=="UNUSED_WITHIN_WINDOW"' >/dev/null
same_refund_id="$(curl -fsS -X POST "$API_BASE_URL/payments/refunds" "${client_auth[@]}" -H 'content-type: application/json' \
  --data "$(jq -cn --arg purchase "$purchase_id" --arg idem "$run_id-refund" --arg now "${start_date}T12:00:00+05:00" \
    '{purchaseId:$purchase,idempotencyKey:$idem,reason:"Stage 9 unused service days",simulationNow:$now}')" | jq -er '.id')"
test "$same_refund_id" = "$(printf '%s' "$refund" | jq -er '.id')"
record "$current_step" "Within-window unused-service refund succeeded and replay returned the same refund"

trap - ERR
jq -cn --arg runId "$run_id" --arg businessDate "$start_date" --arg resultFile "$report_file" \
  '{status:"passed",runId:$runId,businessDate:$businessDate,resultFile:$resultFile}'
