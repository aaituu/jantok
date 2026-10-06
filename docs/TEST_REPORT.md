# Отчёт тестирования JANTOK — Этапы 10–11

Дата: 2026-09-27  
Business timezone: `Asia/Almaty`  
Локальный результат: **42/42 инварианта PASS**  
Stage 11 documentation/final-audit gate: **PASS**  
Hosted CI / Android emulator-device: **PENDING_EXTERNAL / UNAVAILABLE**

## Воспроизведение и изоляция

Основная команда:

```bash
make verify-stage10
```

Она запускает `scripts/verify-stage10.sh`. Runner принимает только disposable Compose project с префиксом `jantok_stage10_`, для каждой крупной группы пересоздаёт отдельные PostgreSQL/Redis/MinIO volumes, применяет все 15 миграций с нуля, загружает детерминированный demo seed и удаляет только свои volumes на выходе. Production-провайдеры и реальные деньги/SMS/курьеры не вызываются.

Машиночитаемый итог: `output/stage10/invariants.jsonl`. Логи отдельных API-наборов: `output/stage10/stage*.log`. Полный Stage 9 real-API сценарий: `output/stage10/stage9-e2e.jsonl`.

## T01–T42: команда → результат

| ID | Команда / проверка | Результат и фактическое доказательство |
| --- | --- | --- |
| T01 | `scripts/verify-stage1-e2e.sh` | PASS — expiry, one-time OTP, пять attempts и phone rate limit проверены; production local-provider запрет покрыт unit gate. |
| T02 | `scripts/verify-stage1-e2e.sh` | PASS — две независимые сессии; refresh rotation и reuse-revocation не затронули чужую сессию. |
| T03 | `verify-stage1/3/5/7-e2e.sh` | PASS — другой user не получил member, purchase return/refund, delivery tracking, чужой attachment/support room или export; ответы не раскрывают ресурс. |
| T04 | `verify-stage1-e2e.sh` + `verify-stage2-e2e.sh` | PASS — анкеты adult/child раздельны, состав quote и итоговая сумма сходятся. |
| T05 | `scripts/verify-stage1-e2e.sh` | PASS — аллерген ребёнка заблокировал только его вариант; обычный adult meal остался SAFE, модификация не обошла gate. |
| T06 | `scripts/verify-stage1-e2e.sh` | PASS — completed questionnaire с `NOT_ANSWERED` отклонён; отсутствие safe meal даёт явную backend-ошибку. |
| T07 | `scripts/verify-stage2-e2e.sh` | PASS — клиент получил семь дней опубликованного меню и только alternatives соответствующего slot. |
| T08 | `cd jantok-backend && npm test -- --run` | PASS — 13:00/14:00/15:00 и kitchen 15:05 проверены before/exact/after по server clock `Asia/Almaty`, независимо от timezone клиента. |
| T09 | `scripts/verify-stage2-e2e.sh` | PASS — server-side start eligibility разрешил завтра только до deadline; сегодня недоступно. |
| T10 | `scripts/verify-stage3-e2e.sh` | PASS — redirect только прочитал state; authoritative capture создал одну подписку, duplicate/late webhook не повторил эффект. |
| T11 | `scripts/verify-stage2-e2e.sh` | PASS — skip/pause сохранили 30 service days, перенесли конец; replay не добавил дни. |
| T12 | `scripts/verify-stage2-e2e.sh` | PASS — суммарный pause limit, overlap и изменение исполненной даты отклонены/обработаны по правилам. |
| T13 | `scripts/verify-stage2-e2e.sh` | PASS — permanent member prorate использовал оставшиеся eligible service days, делитель 30 и явное округление. |
| T14 | `scripts/verify-stage2-e2e.sh` | PASS — guest создан только на оплаченные даты и вошёл в те же household daily orders. |
| T15 | `scripts/verify-stage2-e2e.sh` | PASS — portion/modification price и nutrition snapshots зафиксированы; запрещённое удаление отклонено. |
| T16 | `scripts/verify-stage4-e2e.sh` | PASS — recurring add-on создал 30 units; skip перенёс одну unit, partial refund отменил две, replay не продублировал. |
| T17 | `scripts/verify-stage4-e2e.sh` | PASS — promo → bonus → cash сошлись; 100% bonus quote создал zero payment attempts. |
| T18 | `scripts/verify-stage4-e2e.sh` | PASS — два параллельных checkout с разными keys на один bonus hold дали одну покупку и один conflict; ledger не ушёл в двойной расход. |
| T19 | `scripts/verify-stage4-e2e.sh` | PASS — welcome/referral появились один раз после paid qualification; регистрация и duplicate webhook не начислили повторно. |
| T20 | `scripts/verify-stage4-e2e.sh` | PASS — два household одновременно боролись за последний promo slot: один reservation, один 422; cancellation освободил slot для retry. |
| T21 | `scripts/verify-stage3-e2e.sh` | PASS — before-first-delivery, unused-within-seven-days и admin compensation дали разные суммы/дни/kind. |
| T22 | `scripts/verify-stage3-e2e.sh` + payment policy unit tests | PASS — partial/repeat refund ограничены остатком; cash/bonus reversals воспроизводимы. |
| T23 | `scripts/verify-stage3-e2e.sh` + restart | PASS — notice/service-day renewal schedule учитывает pause/skip/disable; повтор после restart не списал и не продлил дважды. |
| T24 | `scripts/verify-stage4-e2e.sh` | PASS — CLUB учитывает qualifying paid 30-day cycles; автоматического бесплатного 12-го цикла нет. |
| T25 | `verify-stage2-e2e.sh` + `verify-stage6-e2e.sh` | PASS — daily generator/replay не создал дублей; FINAL revision/lock зафиксированы. |
| T26 | `scripts/verify-stage6-e2e.sh` | PASS — recipe/portion/exclusion variants остались раздельны, ingredient totals сошлись. |
| T27 | `scripts/verify-stage6-e2e.sh` | PASS — incomplete packing не достиг READY; label соответствует member и revision, PDF начинается с `%PDF`. |
| T28 | `scripts/verify-stage6-e2e.sh` | PASS — purchase receipt, production, waste и correction дали ожидаемые immutable movements; repeat confirmation не списал снова. |
| T29 | `scripts/verify-stage6-e2e.sh` | PASS — conversion/frozen weighted cost сходятся; один waste учтён один раз. |
| T30 | `scripts/verify-stage5-e2e.sh` | PASS — READY ночью только поставил dispatch job; due run создал одну delivery attempt, повтор — ноль. |
| T31 | `scripts/verify-stage5-e2e.sh` | PASS — unknown/late/duplicate/failure provider events не дали ложный `DELIVERED`. |
| T32 | `scripts/verify-stage5-e2e.sh` | PASS — отсутствующие ETA/tracking/contact остались `null`; reassignment обновил contact. |
| T33 | `scripts/verify-stage5-e2e.sh` | PASS — polygon и max-5 отклонили outside/sixth address; order сохранил старый snapshot. |
| T34 | `scripts/verify-stage7-e2e.sh` + Stage 9 MinIO restart | PASS — messages/photo пережили reconnect/storage restart; чужая room/attachment запрещены. |
| T35 | `scripts/verify-stage7-e2e.sh` | PASS — publish, owner delete и admin hide пересчитали rating и сохранили audit. |
| T36 | `scripts/verify-stage7-e2e.sh` | PASS — SUPPORT/ANALYST/FINANCE получили allow/deny по backend RBAC; last Super Admin guard сработал. |
| T37 | `scripts/verify-stage7-e2e.sh` | PASS — post-cutoff override потребовал permission/reason, записал audit и согласованную delta. |
| T38 | `verify-stage7-e2e.sh` + `verify-stage2-e2e.sh` | PASS — runtime settings изменили будущие расчёты, paid quote snapshots не переписались. |
| T39 | `scripts/verify-stage7-e2e.sh` | PASS — summary/CSV/XLSX совпали с DB control count, filters/timezone; CSV formula escaped, XLSX archive валиден. |
| T40 | `cd jantok-mobile && flutter test` | PASS (automated) — kk/ru/en, 320×568, длинные подписи, открытая клавиатура и offline failure без overflow/crash; ручной адрес не требует location permission. Device run недоступен, см. ограничения. |
| T41 | `verify-stage9-e2e.sh`; restart backend/worker; DB fingerprint | PASS — API/worker вернулись ready; purchase/subscription/service-day/refund/outbox/delivery/bonus/inventory/notification effect counts не изменились. |
| T42 | `environment.spec.ts` + `production-routes.spec.ts` | PASS — production отверг local provider modes и demo seed; OTP inbox, payment и delivery simulator entry points дали `NotFoundException`. |

## Сборки и quality gates

| Команда | Результат |
| --- | --- |
| `./scripts/verify-local.sh` | PASS — Prisma validate/generate, format, ESLint, TypeScript, backend 61/61 unit tests + e2e/build, Admin audit/lint/typecheck/build, Flutter 15/15 tests, Compose config. |
| Clean `prisma migrate deploy` в runner | PASS — все 15 миграций применены с пустой PostgreSQL в каждой группе. |
| `flutter analyze` | PASS — no issues. |
| `flutter test` | PASS — widget/resilience/golden checks. |
| `JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home' flutter build apk --debug --flavor dev --target-platform android-arm64` | PASS — `output/stage10/jantok-dev-debug-arm64.apk`, 111 MiB, SHA-256 `e70f360c76479f3736fa899488e09f938408e76359ac19736ce773e4acf7bbf5`. |
| `docker compose config --quiet` и staging overlay | PASS. |
| `.github/workflows/ci.yml` | Реализованы независимые `backend`, `admin`, `mobile`, `infrastructure`, затем `acceptance`; каждый build/evidence artifact сохраняется, deployment отсутствует. Hosted run не запускался без Git remote/push. |

## Нагрузочная проверка первых клиентов

Команда выполняется в конце `scripts/verify-stage10.sh`:

```bash
LOAD_CLIENTS=25 LOAD_ITERATIONS=8 node scripts/stage10-load.mjs
```

Набор: 25 параллельных клиентов, по 8 последовательных запросов каждому, всего 200 authenticated reads, равномерно по `/household`, `/loyalty/club`, `/payments/history`, `/config/runtime`. Фактический итог: **200/200 успешно, 0 failures, wall 2485 ms, p50 222 ms, p95 726 ms, max 919 ms**. Результат записан в `output/stage10/load.json`; проверка падает при любом HTTP/network failure. Это профиль первых клиентов, а не искусственный million-scale benchmark.

## Визуальная проверка

Flutter goldens/widget renders:

- `jantok-mobile/output/stage8/home.png`
- `jantok-mobile/output/stage8/family_questionnaire.png`
- `jantok-mobile/output/stage8/menu_member_switch.png`
- `jantok-mobile/output/stage8/meal_details_allergy.png`
- `jantok-mobile/output/stage8/checkout.png`
- `jantok-mobile/output/stage8/subscription_calendar.png`
- `jantok-mobile/output/stage8/delivery_tracking.png`
- `jantok-mobile/output/stage8/club.png`

Admin Chrome/real local API:

- `output/stage10/screenshots/admin-dashboard-en.jpg`
- `output/stage10/screenshots/admin-customers-en.jpg`

Через staff OTP на пересобранном локальном стеке проверены login, Dashboard, Customers, navigation и все три режима kk/ru/en. Скриншоты 1440×812 пересняты 2026-09-27. Найденный дефект — показ raw UUID в первой колонке — исправлен: ID остаётся техническим ключом row actions, но не выводится сотруднику; labels/summary keys преобразованы в читаемый локализованный текст.

## Найденные и исправленные проблемы

1. Завершённая анкета принимала `allergyDeclarationStatus=NOT_ANSWERED`; backend теперь возвращает `ALLERGY_DECLARATION_REQUIRED`.
2. Старые Stage 2/3 assertions ожидали прежний cycle/bonus contract; они приведены к 30 service days и cash+bonus allocation.
3. Два checkout могли одновременно пройти household overlap read; добавлен transaction advisory lock по household и конкурентный E2E.
4. Promo global limit был защищён только household lock; добавлен promo-scoped advisory lock и race test двух household.
5. Внутренний UUID показывался в Admin table; технические ID-columns скрыты, headings/summary локализованы.
6. Admin image компилировал API URL без Compose build arg; `NEXT_PUBLIC_API_BASE_URL` передаётся на build stage.
7. Production validation не запрещал `DEMO_SEED_ENABLED=true`; теперь startup fail-closed, simulator routes имеют отдельные production guard tests.
8. Stage 10 nested restart использовал default MinIO ports; runner теперь передаёт все изолированные host-port variables во вложенные scripts.
9. Refund с чужим/несуществующим context ID мог просачивать Prisma `P2025` как HTTP 500; lookup заменён на ownership-safe `findFirst` и явный 404.
10. Concurrent promo fixture использовал phone вне local OTP allowlist и давал ложное падение; fixture переведён на разрешённый детерминированный номер.
11. Forged attachment ownership check не доходил до authorization из-за неполного DTO; test теперь передаёт валидные metadata и подтверждает именно 403 ownership boundary.
12. Flutter golden зависел от `DateTime.now()` и мог меняться от даты запуска; fixture закреплён на управляемой business date.
13. Повторная browser-проверка нашла смешанную подпись `Orders и календарь`; все названия разделов теперь имеют явные kk/ru/en переводы; все три selector-режима повторно просмотрены.

## Этап 11 — финальная сверка

Команда:

```bash
./scripts/verify-stage11.sh
```

Результат: **PASS**. Проверены все обязательные документы, coverage `.env.example`, 111 Prisma models/59 enums/15 migrations, строки traceability 7–11, отсутствие critical placeholder markers в runtime source, syntax shell scripts, local/staging Compose config, runtime OpenAPI (**109 paths / 122 operations / 60 schemas**) и сохранённые T01–T42 (**42/42**).

| # | Критерий | Результат и доказательство |
| --- | --- | --- |
| 1 | Все v1 области имеют backend и client/admin сценарии | **PASS local** — OpenAPI и Admin покрывают customers/subscriptions/menu/payments/refunds/loyalty/delivery/kitchen/inventory/support/analytics/settings; Flutter имеет real-API customer flows. Real providers отделены как external blockers. |
| 2 | Ключевые инварианты | **PASS** — T01–T42 42/42; ownership, duplicate payment/courier/bonus, service days, stock и restart recovery проверены. |
| 3 | Воспроизводимый запуск/миграции/рестарт | **PASS** — setup/start/stop/migrate/seed, persistent volumes, clean 15 migrations, backup/restore drill, Stage 9 restart fingerprint. |
| 4 | Android build и device run разделены | **BUILD PASS / RUN PENDING_EXTERNAL** — APK собран и захеширован; AVD/physical device в environment нет. |
| 5 | iOS composition и native blockers | **SOURCE_READY / BUILD BLOCKED_EXTERNAL** — iOS project/localizations/permissions/deep link есть; Android-only domain dependencies не найдены; нет полного Xcode/CocoaPods/signing/provider entitlements. |
| 6 | Тексты/переводы/UX states, нет пустых кнопок | **PASS local** — kk/ru/en, small screen/keyboard/offline/goldens и Admin browser review; mixed Admin label и raw UUID исправлены. Реальные brand/content ожидают owner approval. |
| 7 | Admin управляет backend, settings/audit/permissions | **PASS** — Stage 7 E2E, Admin build/browser, settings projection без mobile release, append-only audit и role allow/deny. |
| 8 | Traceability не завышает готовность | **PASS** — Этапы 7–11 добавлены; hosted CI/device/iOS/providers/brand имеют `PENDING_EXTERNAL`/`BLOCKED_EXTERNAL`. |
| 9 | Секреты/цены/нормы/providers/brand не придуманы | **PASS** — production fail-closed; полный owner input/timing/config mapping в `CLIENT_DATA_REQUEST.md`; local значения маркированы DEMO. |
| 10 | Нет critical TODO/UnimplementedError/скрытого success catch/bypass | **PASS source/test audit** — runtime marker scan пуст; provider errors переводят operation в UNKNOWN/PENDING/FAILED с persisted retry, а не в success; production simulator guards покрыты tests. |

Найденное на сверке расхождение CI исправлено: infrastructure job теперь передаёт `.env.staging.example` при `compose.staging.yaml`, поэтому обязательный `JANTOK_DOMAIN` не ломает config gate.

## Честно недоступные проверки

- `flutter devices` нашёл только macOS и Chrome; `flutter emulators` сообщил `No emulators available`. Поэтому фактический Android emulator/physical-device visual run не выполнен. APK собран, а small-screen/keyboard/offline/locale состояния проверены widget/golden suite.
- `xcodebuild` недоступен: active developer directory содержит только Command Line Tools. iOS build/device run не выполнялся.
- Git remote/PR и `act` отсутствуют, поэтому GitHub-hosted jobs физически не запускались. Workflow реализован, а его команды воспроизведены локально; зелёный hosted run должен быть подтверждён после первого push.
- Реальные SMS/acquiring/fiscalization/push/Yandex contracts, credentials и production delivery polygon не предоставлены. Production остаётся fail-closed; network tests используют только local simulators.
- Локально установлен Node 25, который не входит в engine-range части dev tooling. Проверки завершились успешно; QUICKSTART, Docker и CI используют поддерживаемый Node 24 LTS. `npm audit --omit=dev` вернул 0 production vulnerabilities для backend и Admin; пять advisories полного backend dependency tree относятся к dev/build tooling и не входят в runtime image.
