#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
INBOX_TOKEN="${OTP_DEV_INBOX_TOKEN:-local-dev-inbox-token-change-before-sharing}"
DB_NAME="${STAGE6_DB_NAME:-jantok}"
STAFF_PHONE="${STAGE6_STAFF_PHONE:-+77000000003}"
CLIENT_PHONE="${STAGE6_CLIENT_PHONE:-+77000000002}"
run_id="stage6-$(date +%s)"

login() {
  local phone="$1" device="$2"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/request" -H 'content-type: application/json' \
    --data "{\"phone\":\"$phone\",\"deviceId\":\"$device\"}" >/dev/null
  local code
  code="$(curl -fsS "$API_BASE_URL/auth/otp/dev-inbox/%2B${phone#+}" -H "x-dev-inbox-token: $INBOX_TOKEN" | jq -er '.code')"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' \
    --data "{\"phone\":\"$phone\",\"deviceId\":\"$device\",\"deviceName\":\"Stage 6 E2E\",\"code\":\"$code\",\"firstName\":\"Stage6\",\"lastName\":\"E2E\"}" | jq -er '.accessToken'
}

STAFF_ACCESS="$(login "$STAFF_PHONE" "$run_id-staff")"
staff_auth=(-H "authorization: Bearer $STAFF_ACCESS")

read -r service_day_id order_id < <(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -AtF ' ' -c \
  "select sd.id,d.id from subscription_service_days sd join subscriptions s on s.id=sd.subscription_id join households h on h.id=s.household_id join users u on u.id=h.owner_user_id join daily_orders d on d.service_day_id=sd.id left join daily_fulfillments f on f.service_day_id=sd.id where u.phone='$CLIENT_PHONE' and f.id is null order by sd.service_date desc limit 1")
test -n "$service_day_id"
test -n "$order_id"

service_date="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select (date '2090-01-01' + (extract(epoch from now())::bigint % 3000)::int)::text")"

docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -v day_id="$service_day_id" -v service_date="$service_date" -v order_id="$order_id" <<'SQL' >/dev/null
update subscription_service_days set service_date=:'service_date'::date where id=:'day_id'::uuid;
update daily_orders set service_date=:'service_date'::date where service_day_id=:'day_id'::uuid;
delete from daily_order_lines where order_id=:'order_id'::uuid;
insert into daily_order_lines
  (id,order_id,meal_type,meal_snapshot,recipe_snapshot,modification_snapshot,nutrition_snapshot,price_snapshot)
select gen_random_uuid(), :'order_id'::uuid, 'BREAKFAST',
  jsonb_build_object('id',m.id,'code',m.code,'nameRu','Овсяная каша'),
  jsonb_build_object('recipeVersion',m.recipe_version,'yieldFactor',m.yield_factor,'lossFactor',m.loss_factor,'ingredients',jsonb_build_array(jsonb_build_object('id',i.id,'code',i.code,'amount',40,'unit','g'))),
  '{"removedIngredientIds":[],"addedIngredientIds":[],"addonIds":[]}'::jsonb,
  '{"weightGrams":280}'::jsonb, '{}'::jsonb
from meals m cross join ingredients i where m.code='DEMO_OAT_PORRIDGE_WATER' and i.code='OATS';
insert into daily_order_lines
  (id,order_id,meal_type,meal_snapshot,recipe_snapshot,modification_snapshot,nutrition_snapshot,price_snapshot)
select gen_random_uuid(), :'order_id'::uuid, 'LUNCH',
  jsonb_build_object('id',m.id,'code',m.code,'nameRu','Овсяная каша'),
  jsonb_build_object('recipeVersion',m.recipe_version,'yieldFactor',m.yield_factor,'lossFactor',m.loss_factor,'ingredients',jsonb_build_array(jsonb_build_object('id',i.id,'code',i.code,'amount',40,'unit','g'))),
  jsonb_build_object('removedIngredientIds',jsonb_build_array((select id from ingredients where code='MILK')),'addedIngredientIds','[]'::jsonb,'addonIds','[]'::jsonb),
  '{"weightGrams":280}'::jsonb, '{}'::jsonb
from meals m cross join ingredients i where m.code='DEMO_OAT_PORRIDGE_WATER' and i.code='OATS';
insert into storage_locations (id,code,name,active)
values (gen_random_uuid(),'MAIN','Основной склад кухни',true)
on conflict (code) do update set name=excluded.name;
SQL

fulfillment_id="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "with inserted as (insert into daily_fulfillments (id,household_id,subscription_id,service_day_id,service_date,address_snapshot,slot_snapshot,dispatch_at,status,financial_status,version,updated_at) select gen_random_uuid(),s.household_id,s.id,sd.id,sd.service_date,jsonb_build_object('streetAddress','Stage 6 test kitchen','latitude',51.1282,'longitude',71.4304),jsonb_build_object('code','SLOT_0600_0800','startMinutes',360,'endMinutes',480),(sd.service_date::timestamp + interval '1 hour') at time zone 'UTC','SCHEDULED','PAID',0,now() from subscription_service_days sd join subscriptions s on s.id=sd.subscription_id where sd.id='$service_day_id' returning id), updated as (update daily_orders d set daily_fulfillment_id=inserted.id from inserted where d.service_day_id='$service_day_id' returning d.id) select id from inserted")"
test -n "$fulfillment_id"
docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "update daily_fulfillments set status='LOCKED',version=version+1 where id='$fulfillment_id';" >/dev/null

ingredient_id="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select id from ingredients where code='OATS'")"
location_id="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select id from storage_locations where code='MAIN'")"
supplier="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/suppliers" "${staff_auth[@]}" -H 'content-type: application/json' --data "{\"code\":\"$run_id\",\"name\":\"Stage 6 supplier\"}")"
supplier_id="$(printf '%s' "$supplier" | jq -er '.id')"
purchase="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/purchases" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "{\"supplierId\":\"$supplier_id\",\"number\":\"$run_id\",\"items\":[{\"ingredientId\":\"$ingredient_id\",\"storageLocationId\":\"$location_id\",\"quantity\":20,\"unit\":\"kg\",\"unitPriceKzt\":10000}]}")"
purchase_item_id="$(printf '%s' "$purchase" | jq -er '.items[0].id')"
curl -fsS -X POST "$API_BASE_URL/staff/kitchen/purchases/items/$purchase_item_id/receive" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "{\"quantity\":20,\"unit\":\"kg\",\"idempotencyKey\":\"$run_id-receipt\"}" >/dev/null

revision="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/production/revisions" "${staff_auth[@]}" -H 'content-type: application/json' \
  --data "{\"serviceDate\":\"$service_date\",\"kind\":\"FINAL\",\"idempotencyKey\":\"$run_id-final\",\"reason\":\"Stage 6 acceptance test\"}")"
revision_id="$(printf '%s' "$revision" | jq -er '.id')"
printf '%s' "$revision" | jq -e '([.lines[] | select(.itemCode=="DEMO_OAT_PORRIDGE_WATER")] | length) == 2' >/dev/null

before_quantity="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select on_hand_quantity from inventory_balances where ingredient_id='$ingredient_id' and storage_location_id='$location_id'")"
run_one="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/production/revisions/$revision_id/confirm" "${staff_auth[@]}" -H 'content-type: application/json' --data "{\"idempotencyKey\":\"$run_id-confirm\",\"shiftCode\":\"MORNING\"}")"
run_two="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/production/revisions/$revision_id/confirm" "${staff_auth[@]}" -H 'content-type: application/json' --data "{\"idempotencyKey\":\"$run_id-confirm\",\"shiftCode\":\"MORNING\"}")"
test "$(printf '%s' "$run_one" | jq -er '.id')" = "$(printf '%s' "$run_two" | jq -er '.id')"
movement_count="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from inventory_movements where reference_id='$revision_id' and type='PRODUCTION'")"
test "$movement_count" = '1'
after_quantity="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select on_hand_quantity from inventory_balances where ingredient_id='$ingredient_id' and storage_location_id='$location_id'")"
test "$before_quantity" != "$after_quantity"

waste_body="{\"ingredientId\":\"$ingredient_id\",\"storageLocationId\":\"$location_id\",\"quantity\":1,\"unit\":\"kg\",\"reason\":\"Stage 6 test trim\",\"wasteDate\":\"$service_date\",\"shiftCode\":\"MORNING\",\"idempotencyKey\":\"$run_id-waste\"}"
waste_one="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/inventory/waste" "${staff_auth[@]}" -H 'content-type: application/json' --data "$waste_body")"
waste_two="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/inventory/waste" "${staff_auth[@]}" -H 'content-type: application/json' --data "$waste_body")"
test "$(printf '%s' "$waste_one" | jq -er '.id')" = "$(printf '%s' "$waste_two" | jq -er '.id')"
test "$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from waste_entries where idempotency_key='$run_id-waste'")" = '1'
curl -fsS "$API_BASE_URL/staff/kitchen/costs?from=$service_date&to=$service_date" "${staff_auth[@]}" | jq -e '
  .wasteCostKzt > 0 and
  .estimatedProductionCostKzt > 0 and
  .totalFoodCostKzt == (.productionCostKzt + .wasteCostKzt) and
  ([.dishCosts[] | select(.itemCode=="DEMO_OAT_PORRIDGE_WATER" and .basis=="ACTUAL")] | length) == 2 and
  (.dailyKitCosts[0].totalKzt > 0) and
  (.paidCycleCosts[0].totalKzt > 0)
' >/dev/null

task_id="$(printf '%s' "$revision" | jq -er '.packingTasks[0].id')"
curl -fsS -X POST "$API_BASE_URL/staff/kitchen/packing/$task_id/start" "${staff_auth[@]}" -H 'content-type: application/json' --data "{\"expectedVersion\":0,\"idempotencyKey\":\"$run_id-pack-start\"}" >/dev/null
incomplete_status="$(curl -sS -o /tmp/jantok-stage6-incomplete.json -w '%{http_code}' -X POST "$API_BASE_URL/staff/kitchen/packing/$task_id/complete" "${staff_auth[@]}" -H 'content-type: application/json' --data "{\"expectedVersion\":1,\"idempotencyKey\":\"$run_id-pack-incomplete\"}")"
test "$incomplete_status" = '409'
jq -e '.error.code == "PACKING_INCOMPLETE"' /tmp/jantok-stage6-incomplete.json >/dev/null
while IFS= read -r packing_item_id; do
  curl -fsS -X PUT "$API_BASE_URL/staff/kitchen/packing/items/$packing_item_id" "${staff_auth[@]}" -H 'content-type: application/json' \
    --data "{\"status\":\"PACKED\",\"expectedVersion\":0,\"idempotencyKey\":\"$run_id-item-$packing_item_id\"}" >/dev/null
done < <(printf '%s' "$revision" | jq -r '.packingTasks[0].items[].id')
completed="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/packing/$task_id/complete" "${staff_auth[@]}" -H 'content-type: application/json' --data "{\"expectedVersion\":1,\"idempotencyKey\":\"$run_id-pack-complete\"}")"
printf '%s' "$completed" | jq -e '.status == "COMPLETE" and .fulfillment.status == "READY"' >/dev/null

print_document="$(curl -fsS -X POST "$API_BASE_URL/staff/kitchen/print" "${staff_auth[@]}" -H 'content-type: application/json' --data "{\"type\":\"PRODUCTION_LIST\",\"revisionId\":\"$revision_id\",\"pageSize\":\"A4\",\"idempotencyKey\":\"$run_id-print\"}")"
print_id="$(printf '%s' "$print_document" | jq -er '.id')"
curl -fsS "$API_BASE_URL/staff/kitchen/print/$print_id/pdf" "${staff_auth[@]}" -o /tmp/jantok-stage6-production.pdf
test "$(head -c 4 /tmp/jantok-stage6-production.pdf)" = '%PDF'

echo 'Stage 6 E2E passed: variants stay separate; production/waste are idempotent; incomplete packing is blocked and complete packing reaches READY; PDF is valid.'
