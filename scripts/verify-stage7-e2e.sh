#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
INBOX_TOKEN="${OTP_DEV_INBOX_TOKEN:-local-dev-inbox-token-change-before-sharing}"
DB_NAME="${STAGE7_DB_NAME:-jantok}"
SUPER_PHONE="${STAGE7_SUPER_PHONE:-+77000000003}"
SECOND_SUPER_PHONE="${STAGE7_SECOND_SUPER_PHONE:-+77000000004}"
SUPPORT_PHONE="${STAGE7_SUPPORT_PHONE:-+77000000001}"
SCOPED_PHONE="${STAGE7_SCOPED_PHONE:-+77000000002}"
run_id="stage7-$(date +%s)"
from_date="$(date -v-29d +%F 2>/dev/null || date -d '-29 days' +%F)"
to_date="$(date +%F)"

login() {
  local phone="$1" device="$2" first="$3"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/request" -H 'content-type: application/json' \
    --data "{\"phone\":\"$phone\",\"deviceId\":\"$device\"}" >/dev/null
  local code
  code="$(curl -fsS "$API_BASE_URL/auth/otp/dev-inbox/%2B${phone#+}" -H "x-dev-inbox-token: $INBOX_TOKEN" | jq -er '.code')"
  curl -fsS -X POST "$API_BASE_URL/auth/otp/verify" -H 'content-type: application/json' \
    --data "{\"phone\":\"$phone\",\"deviceId\":\"$device\",\"deviceName\":\"Stage 7 E2E\",\"code\":\"$code\",\"firstName\":\"$first\",\"lastName\":\"E2E\"}" | jq -er '.accessToken'
}

SUPPORT_ACCESS="$(login "$SUPPORT_PHONE" "$run_id-support" '=STAGE7_FORMULA')"
SCOPED_ACCESS="$(login "$SCOPED_PHONE" "$run_id-scoped" Scoped)"
SUPER_ACCESS="$(login "$SUPER_PHONE" "$run_id-super" Super)"
SECOND_SUPER_ACCESS="$(login "$SECOND_SUPER_PHONE" "$run_id-second-super" Backup)"
super_auth=(-H "authorization: Bearer $SUPER_ACCESS")
second_super_auth=(-H "authorization: Bearer $SECOND_SUPER_ACCESS")

support_user_id="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select id from users where phone='$SUPPORT_PHONE'")"
foreign_attachment_status="$(curl -sS -o /tmp/jantok-stage7-foreign-attachment.json -w '%{http_code}' \
  -X POST "$API_BASE_URL/support/threads" -H "authorization: Bearer $SCOPED_ACCESS" -H 'content-type: application/json' \
  --data "{\"reason\":\"OTHER\",\"subject\":\"Foreign attachment\",\"body\":\"Must be rejected\",\"clientMessageId\":\"$run_id-foreign-file\",\"attachments\":[{\"objectKey\":\"support/$support_user_id/$run_id.png\",\"contentType\":\"image/png\",\"sizeBytes\":68,\"sha256\":\"0000000000000000000000000000000000000000000000000000000000000000\"}]}")"
test "$foreign_attachment_status" = '403'

thread="$(curl -fsS -X POST "$API_BASE_URL/support/threads" -H "authorization: Bearer $SUPPORT_ACCESS" -H 'content-type: application/json' \
  --data "{\"reason\":\"OTHER\",\"subject\":\"Stage 7 ownership\",\"body\":\"Persistent support message\",\"clientMessageId\":\"$run_id-first\",\"attachments\":[]}")"
thread_id="$(printf '%s' "$thread" | jq -er '.id')"
foreign_status="$(curl -sS -o /tmp/jantok-stage7-foreign.json -w '%{http_code}' "$API_BASE_URL/support/threads/$thread_id/messages" -H "authorization: Bearer $SCOPED_ACCESS")"
test "$foreign_status" = '403'

docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -v support_phone="$SUPPORT_PHONE" -v scoped_phone="$SCOPED_PHONE" <<'SQL' >/dev/null
insert into employees (id,phone,user_id,status,created_at,updated_at)
select gen_random_uuid(),u.phone,u.id,'ACTIVE',now(),now() from users u
where u.phone in (:'support_phone', :'scoped_phone')
on conflict (phone) do update set user_id=excluded.user_id,status='ACTIVE',updated_at=now();
delete from employee_roles er using employees e
where er.employee_id=e.id and e.phone in (:'support_phone', :'scoped_phone');
insert into employee_roles (employee_id,role_id,assigned_at)
select e.id,r.id,now() from employees e cross join roles r
where e.phone=:'support_phone' and r.code='SUPPORT';
insert into employee_roles (employee_id,role_id,assigned_at)
select e.id,r.id,now() from employees e cross join roles r
where e.phone=:'scoped_phone' and r.code='ANALYST';
SQL

curl -fsS "$API_BASE_URL/staff/support/threads" -H "authorization: Bearer $SUPPORT_ACCESS" | jq -e 'type == "array"' >/dev/null
support_denied="$(curl -sS -o /tmp/jantok-stage7-support-denied.json -w '%{http_code}' "$API_BASE_URL/staff/analytics/summary" -H "authorization: Bearer $SUPPORT_ACCESS")"
test "$support_denied" = '403'
curl -fsS "$API_BASE_URL/staff/analytics/summary" -H "authorization: Bearer $SCOPED_ACCESS" | jq -e '.period.timezone == "Asia/Almaty"' >/dev/null
analyst_denied="$(curl -sS -o /tmp/jantok-stage7-analyst-denied.json -w '%{http_code}' "$API_BASE_URL/staff/resources/customers" -H "authorization: Bearer $SCOPED_ACCESS")"
test "$analyst_denied" = '403'

docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 -v phone="$SCOPED_PHONE" <<'SQL' >/dev/null
delete from employee_roles er using employees e where er.employee_id=e.id and e.phone=:'phone';
insert into employee_roles (employee_id,role_id,assigned_at)
select e.id,r.id,now() from employees e cross join roles r where e.phone=:'phone' and r.code='FINANCE';
SQL
curl -fsS "$API_BASE_URL/staff/resources/payments" -H "authorization: Bearer $SCOPED_ACCESS" | jq -e 'type == "array"' >/dev/null
finance_denied="$(curl -sS -o /tmp/jantok-stage7-finance-denied.json -w '%{http_code}' "$API_BASE_URL/staff/support/threads" -H "authorization: Bearer $SCOPED_ACCESS")"
test "$finance_denied" = '403'

reply="$(curl -fsS -X POST "$API_BASE_URL/staff/support/threads/$thread_id/messages" -H "authorization: Bearer $SUPPORT_ACCESS" -H 'content-type: application/json' \
  --data "{\"body\":\"Staff response persists before realtime delivery\",\"clientMessageId\":\"$run_id-reply\",\"attachments\":[]}")"
reply_id="$(printf '%s' "$reply" | jq -er '.id')"
repeat_reply="$(curl -fsS -X POST "$API_BASE_URL/staff/support/threads/$thread_id/messages" -H "authorization: Bearer $SUPPORT_ACCESS" -H 'content-type: application/json' \
  --data "{\"body\":\"Staff response persists before realtime delivery\",\"clientMessageId\":\"$run_id-reply\",\"attachments\":[]}")"
test "$(printf '%s' "$repeat_reply" | jq -er '.id')" = "$reply_id"
test "$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from notification_outbox where idempotency_key='support-reply:$reply_id'")" = '1'
curl -fsS -X POST "$API_BASE_URL/staff/notifications/dispatch" "${super_auth[@]}" | jq -e 'length >= 1' >/dev/null
test "$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select status from notification_outbox where idempotency_key='support-reply:$reply_id'")" = 'SENT'

post_setting() {
  local group="$1" key="$2" value="$3"
  jq -cn --arg group "$group" --arg key "$key" --arg idem "$run_id-$group-$key" --argjson value "$value" \
    '{groupCode:$group,key:$key,status:"APPROVED",value:$value,idempotencyKey:$idem,reason:"Stage 7 acceptance configuration"}' |
    curl -fsS -X POST "$API_BASE_URL/staff/settings" "${super_auth[@]}" -H 'content-type: application/json' --data-binary @- >/dev/null
}
post_setting CUTOFF POLICY '{"timezone":"Asia/Almaty","menuMinutes":777,"paymentMinutes":780,"skipMinutes":840,"addressMinutes":840,"deliveryMinutes":840,"standaloneAddonMinutes":900,"kitchenLockMinutes":905,"serviceDaysPerCycle":31,"maxPauseCalendarDays":30}'
post_setting PRICING RULES '{"adultMonthlyKzt":31001,"teenMonthlyKzt":27000,"childMonthlyKzt":24000,"infantMonthlyKzt":18000,"secondMemberDiscountBps":500,"thirdPlusDiscountBps":1000,"guestDayKzt":1200}'
post_setting CLUB LEVELS '{"levels":[{"code":"STAGE7_MEMBER","nameKk":"Member","nameRu":"Member","nameEn":"Member","thresholdPaidCycles":4,"bonusMultiplierBps":10000,"benefits":{"stage7":true}}]}'
curl -fsS "$API_BASE_URL/config/runtime" | jq -e '.effective.cutoff.menuMinutes == 777 and .effective.cutoff.serviceDaysPerCycle == 31 and .effective.pricing.adultMonthlyKzt == 31001 and ([.effective.club[] | select(.code=="STAGE7_MEMBER" and .thresholdPaidCycles==4)] | length) == 1' >/dev/null

second_super_id="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select id from employees where phone='$SECOND_SUPER_PHONE'")"
self_super_id="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select id from employees where phone='$SUPER_PHONE'")"
curl -fsS -X DELETE "$API_BASE_URL/staff/employees/$second_super_id/roles" "${super_auth[@]}" -H 'content-type: application/json' --data '{"roleCode":"SUPER_ADMIN","reason":"Stage 7 last-owner guard test"}' >/dev/null
last_admin_status="$(curl -sS -o /tmp/jantok-stage7-last-admin.json -w '%{http_code}' -X DELETE "$API_BASE_URL/staff/employees/$self_super_id/roles" "${super_auth[@]}" -H 'content-type: application/json' --data '{"roleCode":"SUPER_ADMIN","reason":"Must retain last active owner"}')"
test "$last_admin_status" = '403'
curl -fsS -X POST "$API_BASE_URL/staff/employees/$second_super_id/roles" "${super_auth[@]}" -H 'content-type: application/json' --data '{"roleCode":"SUPER_ADMIN","reason":"Restore second owner after guard test"}' >/dev/null

docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "update users set first_name='=STAGE7_FORMULA',created_at=now() where phone='$SUPPORT_PHONE';" >/dev/null
control_count="$(docker compose exec -T postgres psql -U jantok -d "$DB_NAME" -Atc "select count(*) from users where deleted_at is null and created_at >= date '$from_date' and created_at < date '$to_date' + interval '1 day'")"
csv_job="$(curl -fsS -X POST "$API_BASE_URL/staff/analytics/exports" "${super_auth[@]}" -H 'content-type: application/json' \
  --data "{\"reportType\":\"CUSTOMERS\",\"format\":\"CSV\",\"from\":\"$from_date\",\"to\":\"$to_date\"}")"
csv_job_id="$(printf '%s' "$csv_job" | jq -er '.id')"
test "$(printf '%s' "$csv_job" | jq -er '.rowCount')" = "$control_count"
curl -fsS "$API_BASE_URL/staff/analytics/exports/$csv_job_id/download" "${super_auth[@]}" -o /tmp/jantok-stage7-customers.csv
grep -F "'=STAGE7_FORMULA" /tmp/jantok-stage7-customers.csv >/dev/null
foreign_export_status="$(curl -sS -o /tmp/jantok-stage7-foreign-export.bin -w '%{http_code}' \
  "$API_BASE_URL/staff/analytics/exports/$csv_job_id/download" "${second_super_auth[@]}")"
test "$foreign_export_status" = '404'
xlsx_job="$(curl -fsS -X POST "$API_BASE_URL/staff/analytics/exports" "${super_auth[@]}" -H 'content-type: application/json' --data '{"reportType":"MEALS","format":"XLSX"}')"
xlsx_job_id="$(printf '%s' "$xlsx_job" | jq -er '.id')"
curl -fsS "$API_BASE_URL/staff/analytics/exports/$xlsx_job_id/download" "${super_auth[@]}" -o /tmp/jantok-stage7-meals.xlsx
unzip -t /tmp/jantok-stage7-meals.xlsx >/dev/null

echo 'Stage 7 E2E passed: object ownership and restricted-role allow/deny, support dedupe/push outbox, last Super Admin guard, runtime cutoff/pricing/CLUB settings, matching CSV control data, formula safety and valid XLSX.'
