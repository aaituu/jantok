# Статус реализации JANTOK

Обновлено: 2026-09-27. Этапы 0–11: **LOCAL_VERIFIED**. Реальные SMS/payment/fiscalization/push/Yandex providers, production delivery zone, hosted CI и store/device signing: **BLOCKED/PENDING_EXTERNAL**.

## Этап 11 — результат

- Документация сверена с фактическим кодом: 111 Prisma models, 59 enums, 15 migrations, runtime OpenAPI, Socket.IO support, BullMQ jobs и domain state machines.
- Добавлены `QUICKSTART.md`, `docs/DATABASE.md` с logical ERD, `docs/API.md`, `docs/INTEGRATIONS.md`, `docs/DEPLOYMENT.md`, `docs/IOS_READINESS.md` и единый `docs/CLIENT_DATA_REQUEST.md`.
- Traceability расширена на Этапы 7–11; hosted CI, Android device run, iOS tooling, providers и brand/store owner inputs не выданы за локально готовые.
- CI staging config исправлен: Compose overlay теперь проверяется с `.env.staging.example`, где есть обязательный `JANTOK_DOMAIN`.
- `scripts/verify-stage11.sh` проверяет комплектность документов, env coverage, models/migrations, traceability, runtime placeholder scan, Compose configs, OpenAPI и сохранённые 42/42 evidence.

## Этап 10 — результат

- `scripts/verify-stage10.sh` поднимает свежую изолированную БД/Redis/MinIO для каждой крупной группы и выполняет T01–T42 через реальные application/API boundaries; результат сохраняется в `output/stage10/invariants.jsonl`.
- Финальный прогон 2026-09-27: **42/42 PASS**, backend **61/61**, Flutter **15/15**, load **200/200** без ошибок (p50 222 ms, p95 726 ms, max 919 ms).
- Добавлены настоящие конкурентные проверки одного bonus hold и последнего promo slot; checkout сериализован по household, общий promo usage — по promo ID. Расширены проверки ownership для member, refund/return, delivery tracking, attachment, support room и export.
- Flutter проверяется в kk/ru/en на экране 320×568, с открытой клавиатурой и offline-ошибкой; visual goldens сохраняются в `jantok-mobile/output/stage8`. Android ARM64 dev APK (111 MiB, SHA-256 `e70f360c76479f3736fa899488e09f938408e76359ac19736ce773e4acf7bbf5`) собран в `output/stage10/jantok-dev-debug-arm64.apk`.
- Admin проверен в Chrome через staff OTP на dashboard и таблице Customers; внутренние UUID больше не выводятся как операционная колонка. Скриншоты сохранены в `output/stage10/screenshots`.
- CI разделён на backend/admin/mobile/infrastructure и зависимый acceptance job; build/evidence artifacts сохраняются, deployment отсутствует. Hosted GitHub Actions не запускался без remote/push — локальный результат и этот внешний шаг различаются в `docs/TEST_REPORT.md`.
- Load profile: 25 клиентов × 8 запросов по четырём защищённым read endpoints; фактические latency/error metrics сохраняются в `output/stage10/load.json`.

## Этап 9 — результат

- Добавлены безопасные `setup/start/stop/migrate/seed/verify/backup/restore`, случайные local secrets без перезаписи существующего `.env`, persistent volumes и отдельные local/staging/production конфигурации.
- Local simulators проходят те же application/webhook boundaries и запрещены production validation/routes; worker получает полный environment, восстанавливает BullMQ schedulers после рестарта и пишет structured failure/ready/shutdown events.
- Идемпотентный demo seed создаёт каталог, меню, безопасный/аллергенный вариант, две Super Admin персоны, пять сотрудников с ограниченными ролями и incomplete/single/family customer fixtures. Изменяемые финансовые/операционные данные создаются real-API E2E, а не прямой вставкой успешных платежей.
- Полный сценарий OTP → анкета → recommendation → quote/payment → replacement/add-ons → cutoff → production/stock → packing/PDF → delivery → review/support photo → refund и 100% bonus payment прошёл: 16/16 шагов.
- PostgreSQL + MinIO backup/restore, stop/start persistence и restart-idempotency scheduler проверены фактически. Подробный протокол — `docs/TEST_REPORT.md`.

## Этап 6 — результат

- Добавлен kitchen/inventory модуль: `FORECAST/FINAL/DELTA` revisions, раздельные variant lines, recipe version/yield/loss snapshots, план/факт и атомарное подтверждение production.
- Склад хранит on-hand/reserved/available, immutable movements, storage locations, suppliers/purchases/partial receipt, waste/corrections/returns/transfers, unit normalization и weighted-average valuation с DB guards от отрицательного остатка.
- Packing tasks агрегированы по household и member/guest. Каждая позиция подтверждается отдельно; неполная упаковка не переводит fulfillment в `READY`.
- PDF/HTML production/packing/label layouts имеют page size, preview, SHA-256, историю/reprint; неизвестная модель принтера не заявлена совместимой. Admin показывает ревизии, варианты, packing progress и остатки.
- Cost report разделяет actual production/waste, не считает waste movement дважды и показывает recognized revenue, gross margin и food-cost percentage.
- Добавлена миграция `20260924210000_stage6_kitchen_inventory`, документация и сквозной `verify-stage6-e2e.sh`.

## Этап 5 — результат

- Геометрическая delivery zone, max-5 адресов, snapshots и три бесплатных перекрывающихся слота проверяются backend.
- Household daily fulfillment отделяет physical и financial state; команды переходов, events и optimistic version не позволяют произвольный status patch.
- `DeliveryProvider`, simulator, scheduled dispatch, stable provider idempotency, retries/reconciliation и capability-gated tracking реализованы; production ждёт договора Яндекс и согласованной зоны.

## Этап 4 — результат

- Add-on catalog расширен категориями, локализацией описания/состава, фото/unit, обычной и recurring ценой. Recurring plan хранит paid/remaining units и service-day allocations; неоплаченные allocations имеют `PENDING_PAYMENT`, skip/pause переносит оплаченную единицу без нового charge, а частичный refund отменяет только выбранные будущие единицы и восстанавливает cash/bonus части.
- Promo reservation и bonus reservation выполняются транзакционно под household lock. Расчёт строго `discount → bonus → cash`, не уходит ниже нуля; usage limits учитывают конкурентные checkout и освобождают истёкшие reservations.
- Bonus ledger append-only поддерживает credit/debit/reserve/release/refund/compensation/reversal. Welcome 10% начисляется один раз от фактической cash-части первой успешной подписки; 100% bonus checkout не создаёт payment attempt.
- Referral создаётся при регистрации по коду и квалифицируется только authoritative successful purchase. Новое событие получает текущий tier без retroactive repricing; duplicate webhook не начисляет повторно, refund создаёт пропорциональное сторно.
- CLUB считает только qualifying paid 30-service-day cycles, серверно применяет tier и отдаёт wallet/history/progress/privacy-safe friend list. Flutter получил CLUB screen, Admin — просмотр и создание draft loyalty/promo settings; backend также управляет referral/CLUB tiers.
- Добавлены миграции `20260924160000_stage4_loyalty_addons_referral_club`, `20260924163000_stage4_recurring_addon_checkout` и `20260924170000_stage4_recurring_addon_refunds`.

## Этап 3 — результат

- Добавлены `PaymentProvider`/`FiscalizationProvider`, deterministic local simulators и production-safe `unconfigured` adapters. Schema/API не принимают и не хранят PAN/CVV; saved methods содержат opaque token/mandate и masked metadata.
- Checkout теперь сохраняет purchase/attempt/outbox до provider call и активирует подписку только после authoritative capture. Webhook проверяет HMAC, сохраняет уникальный event ID/result, игнорирует duplicate/stale events; deep-link return только читает server state.
- Реализованы payment history, saved methods, независимый lifecycle sale/refund receipt, явно нефискальная тестовая квитанция и staff registration реального документа с permission/audit.
- Renewal job привязан к фактическому `currentEndDate`, хранит frozen price/terms/notice, требует consent + active mandate, переносится при pause/skip и использует bounded retry/stable provider operation. Успех атомарно добавляет 30 service days без второго продления при повторном job.
- Стандартный refund различает до первой доставки и неиспользованную часть в конфигурируемые 7 календарных дней; administrative compensation имеет отдельный RBAC path. Cash/bonus bounds проверяются backend, bonus восстанавливается append-only ledger записью, повторный запрос возвращает исходный refund.
- Добавлена миграция `20260924120000_stage3_payments_refunds_renewals` и 8 новых payment/refund/receipt/renewal/outbox таблиц.

## Этап 2 — результат

- Опубликованное меню хранится по date/slot, отдаётся по семь дней и содержит kk/ru/en, фото, состав, вес, macros, allergens, rating/reviews, recommendation/alternatives и member-specific safety. Выбор разрешён только из публикации; removals/additions/add-ons проходят allowlist/stock/safety, а recipe/nutrition/price snapshots фиксируются также в daily order lines.
- Единый `CutoffService` использует Asia/Almaty и строгое `<`: menu/payment 13:00, skip/pause/address/delivery 14:00, standalone add-on 15:00, kitchen lock 15:05. Версии policy неизменяемы; тесты покрывают millisecond before/at/after каждого boundary.
- Subscription создаёт 30 service-day allocations и participant daily orders. Реализованы idempotent skip с переносом, несколько pause без overlap и лимитом 30 дней, перенос orders/snapshots, auto-renew, paid prorate постоянного участника, guest selected days, отдельный standalone add-on checkout, admin free day/skip exception с permission/reason/audit/recalc/notification task.
- Pricing использует только DEMO rules local/test и ACTIVE production, возрастные ставки, family basis-point discounts, guests/add-ons/bonus; quote itemized и immutable после принятия. Purchase/payment/subscription/order разделены; zero-cash не создаёт bank attempt. Production cash checkout закрыт до реального provider adapter.
- Добавлены пять последовательных миграций Этапа 2 поверх трёх прежних: core menu/subscription/pricing, DB immutability, subscription changes, meal reviews, standalone add-ons.
- Flutter получил экран семидневного меню, itemized quote и календаря подписки; Next.js staff dashboard показывает версии pricing/cut-off.

## Этап 1 — результат

- Phone OTP реализован через provider interface: HMAC challenge, expiry/attempts/resend, Redis rate limits phone/IP/device, allowlist и закрытый local inbox. Local adapter не может стартовать в production.
- Access/refresh sessions независимы по устройствам; refresh вращается, reuse отзывает сессию и push tokens; доступны current logout, список и точечный revoke. Push token хранится AES-256-GCM ciphertext + HMAC.
- Household создаётся при регистрации; реализованы unlimited members, анкеты/справочники, адрес Астаны и persisted onboarding. Изменение профиля пересчитывает существующие будущие рекомендации; новая аллергия помечает будущие выборы конфликтными и создаёт staff task.
- Nutrition Engine выбирает `DEMO` rules только local/test и `APPROVED` только production, использует явные versioned coefficients для возраста/антропометрии/activity/sport/goal и сохраняет snapshots/30-дневное предложение.
- Backend safety gate проверяет global halal, verified composition, diet tags, прямые/ingredient allergen risks, допустимые удаления, additions/add-ons и блокирующий free text. Нет безопасного блюда — объяснимый 422 + staff task.
- RBAC вычисляется backend; два production Super Admin обязательны через env, local demo admins отделены. Flutter auth/household/questionnaire/address flow и защищённый staff login Next.js подключены к API.
- Добавлены миграции `20260922022000_stage1_auth_household_nutrition` и `20260922030000_stage1_questionnaire_integrity`; foundation migration не изменялась.

## Реализовано

| Блок | Статус | Фактический результат |
| --- | --- | --- |
| Аудит/workspace | `LOCAL_VERIFIED` | Master-spec 1–6, 29, 30, 35, 36, 41 и уточнённое вложение прочитаны; Git и требуемая top-level структура созданы; исходный Flutter сохранён |
| Mobile | `LOCAL_VERIFIED` | Flutter 3.47.5, Riverpod 3, go_router 18, Android/iOS codebase, smoke test |
| Backend/API | `LOCAL_VERIFIED` | NestJS 12 modular monolith, `/api/v1`, Swagger, validation/CORS/helmet, graceful shutdown, PostgreSQL/Redis/S3 readiness |
| Worker | `LOCAL_VERIFIED` | Отдельный BullMQ process; реальный `system/healthcheck` job обработан и вернул результат |
| Data | `LOCAL_VERIFIED` | Prisma 7.10; первая migration для 6 identity/family таблиц с UUID/FK/index/unique/check; применена на чистой PostgreSQL |
| Admin | `LOCAL_VERIFIED` | Next.js 16/React/TypeScript, lint/typecheck/production build и container HTTP 200 |
| Infrastructure | `LOCAL_VERIFIED` | PostgreSQL 17, Redis 8, MinIO, backend, worker, admin; persistent volumes, healthchecks, idempotent bucket bootstrap |
| Nginx | `LOCAL_VERIFIED` | Staging TLS/WebSocket template прошёл `nginx -t` в `nginx:1.28-alpine` |
| Secrets | `LOCAL_VERIFIED` | `.env` исключён; safe local defaults и все известные owner inputs записаны в ENV_REQUIRED |
| CI | `LOCAL_VERIFIED` | Independent backend/admin/mobile jobs + infrastructure config; весь набор команд воспроизведён локально через `scripts/verify-local.sh` |
| Docs | `LOCAL_VERIFIED` | ENV/status/traceability/architecture/assumptions и точный README/Quickstart заполнены |
| Stage 1 Auth/RBAC | `LOCAL_VERIFIED` | OTP provider/local inbox, multi-device rotating sessions, push binding, backend permissions и Super Admin bootstrap |
| Stage 1 Household | `LOCAL_VERIFIED` | Persisted onboarding, unlimited members, complete questionnaire/catalog/address model, profile-triggered recomputation/tasks |
| Stage 1 Nutrition safety | `LOCAL_VERIFIED` | Versioned deterministic rules, age snapshots, 30 days, halal/diet/allergen/addition/add-on server gate |
| Stage 1 clients | `LOCAL_VERIFIED` | Flutter secure session restore + auth/onboarding UI; Next.js staff OTP login checked by `/staff/me` permission |
| Stage 2 menu/cut-off | `LOCAL_VERIFIED` | Published 7-day cards/alternatives/safety/snapshots; unified strict boundary service and separate add-on cutoff |
| Stage 2 pricing/subscription | `LOCAL_VERIFIED` | Itemized immutable quotes, 30-day allocation/order ledger, skip/pause, prorate member, guest, add-on, auto-renew and admin extension |
| Stage 2 clients | `LOCAL_VERIFIED` | Flutter menu/quote/calendar and staff pricing/cut-off visibility |
| Stage 3 payment core | `LOCAL_VERIFIED` | Provider interfaces/simulators, persisted attempts/outbox, authoritative capture, webhook dedupe/order handling, payment history and masked methods |
| Stage 3 refunds/receipts | `LOCAL_VERIFIED` | Standard/admin refund policies, partial bounds, bonus ledger, independent sale/refund receipt and manual fiscal registration |
| Stage 3 renewal | `LOCAL_VERIFIED` | Consent/mandate, configurable notice, service-day scheduling, pause/skip reschedule, bounded retry and restart-safe finalization |
| Stage 3 real providers | `BLOCKED_EXTERNAL` | Business has not selected acquiring/fiscalization vendors or supplied official contracts/accounts/keys |
| Stage 4 add-ons/promo | `LOCAL_VERIFIED` | Localized catalog, recurring allocations, provider-backed mixed payment, promo limits/reservations and transfer on skip/pause |
| Stage 4 bonus/referral | `LOCAL_VERIFIED` | Immutable reconstructable wallet, atomic reserves, welcome/referral qualification, refund reversals and webhook dedupe |
| Stage 4 CLUB/clients | `LOCAL_VERIFIED` | Paid-cycle tier engine, privacy-safe dashboard, Flutter CLUB screen and RBAC Admin settings |
| Stage 5 address/slots | `LOCAL_VERIFIED` | Max-5 addresses, polygon zone, immutable snapshots and free overlapping slots |
| Stage 5 delivery/order | `LOCAL_VERIFIED` | Household fulfillment state machine, scheduled provider job, reconciliation and honest tracking fallback |
| Stage 5 external Yandex | `BLOCKED_EXTERNAL` | Contract, KZ method availability, token and confirmed production polygon are not supplied |
| Stage 6 production/packing | `LOCAL_VERIFIED` | Versioned aggregate production, separated variants, atomic fact, member packing and incomplete guard |
| Stage 6 inventory/cost | `LOCAL_VERIFIED` | Unit-safe stock/reservations, suppliers/receipts/movements/waste, weighted average and non-duplicating cost report |
| Stage 6 print/Admin | `LOCAL_VERIFIED` | Stored PDF/HTML snapshots, preview/reprint history and kitchen/inventory staff dashboard |
| Stage 9 local operations | `LOCAL_VERIFIED` | Compose stack, safe scripts, explicit simulators, production fail-closed validation, backups/restores and restart-safe worker |
| Stage 9 full E2E | `LOCAL_VERIFIED` | 16/16 real-API steps passed; JSONL evidence and detailed report persisted |
| Stage 10 invariants | `LOCAL_VERIFIED` | T01–T42 on disposable stacks, restart fingerprint, production route guards and concurrent loyalty races |
| Stage 10 visual/build | `LOCAL_VERIFIED` | Flutter widget/golden checks, Chrome Admin review, Android ARM64 debug APK and saved screenshots |
| Hosted CI run | `PENDING_EXTERNAL` | Workflow is implemented and reproduced locally; a green GitHub-hosted run requires the first push to a configured remote |
| Stage 11 documentation | `LOCAL_VERIFIED` | Required docs, logical ERD, runtime API/realtime/jobs/states, integrations, deployment and iOS readiness reflect source/evidence |
| Stage 11 owner handoff | `LOCAL_VERIFIED` | One Russian `CLIENT_DATA_REQUEST.md` maps every external access to purpose/timing/config and separates business/store/brand decisions |

## Выполненные проверки

| Команда | Результат |
| --- | --- |
| `./scripts/verify-local.sh` | exit 0: backend format/lint/typecheck/unit/e2e/build; admin audit/lint/typecheck/build; Flutter format/analyze/test; Compose config |
| `./scripts/verify-stage11.sh` | documentation/env/model/traceability/source/Compose/OpenAPI/T01–T42 evidence gate |
| `./scripts/verify-compose.sh` | exit 0: отдельные пустые volumes, все services healthy, readiness OK, migration `20260922000100_foundation` applied; test volumes удалены |
| `docker compose up --build --detach --wait` | exit 0; обычный stack `jantok` оставлен запущенным |
| `curl http://localhost:8080/api/v1/health/ready` | HTTP 200; `postgres`, `redis`, `storage` = `up` |
| `curl http://localhost:3000` | HTTP 200 |
| BullMQ enqueue + `waitUntilFinished` | worker вернул `processedAt` и исходный payload |
| `npm audit --omit=dev` (backend/admin) | 0 production vulnerabilities в обоих приложениях |
| `nginx -t` в `nginx:1.28-alpine` | syntax ok; test successful |
| `git diff --check` и forbidden-placeholder scan authored sources | ошибок/заглушек в runtime source не найдено |
| `./scripts/verify-stage1-e2e.sh` | exit 0: OTP registration, 2 members, restart persistence, 2 devices, refresh reuse revocation, child-only allergen 422, adult SAFE, 30-day recommendation |
| `./scripts/verify-compose.sh` | exit 0 на clean volumes: 3 migrations applied; backend/worker/admin/db/redis/storage healthy; test volumes удалены |
| `./scripts/verify-local.sh` | exit 0: backend 11 unit + 1 e2e, lint/typecheck/build/audit; admin lint/typecheck/build/audit; Flutter format/analyze/widget; Compose config |
| `docker compose up -d --wait` | exit 0; normal persistent stack снова оставлен healthy |
| backend `format:check`, `lint`, `typecheck`, `test`, `build` | exit 0; 21 unit tests, включая все cut-off boundaries |
| admin `lint`, `tsc --noEmit`, `build`, `npm audit --omit=dev` | exit 0; production build, 0 production vulnerabilities |
| mobile `dart format --set-exit-if-changed`, `flutter analyze`, `flutter test` | exit 0; no issues, widget test passed |
| `./scripts/verify-stage2-e2e.sh` | exit 0: immutable quote, 30 planned days, 7-day alternatives, snapshots, 67 recalculated orders, member prorate, guest, standalone add-on, skip/pause, auto-renew |
| admin free-day API + DB query | permission accepted; `SUBSCRIPTION_FREE_SERVICE_DAY` audit row recorded |
| `./scripts/verify-compose.sh` | exit 0 на clean volumes: все 8 migrations applied; backend/worker/admin/db/redis/storage healthy; temporary volumes removed |
| Prisma `migrate status` + `migrate diff --exit-code` | schema up to date; no difference detected |
| `docker compose build backend`, `docker compose build worker`, затем `docker compose up --detach --wait` | exit 0 после перезапуска Docker Desktop из-за containerd I/O; normal persistent stack оставлен healthy |
| backend `format:check`, `lint`, `typecheck`, `test`, `build` (Этап 3) | exit 0; 30 unit/contract tests, включая refund boundaries, renewal schedule и provider contracts |
| clean PostgreSQL `prisma migrate deploy` + `migrate status` | exit 0; все 9 миграций, включая Stage 3, применены с нуля; schema up to date |
| `./scripts/verify-stage3-e2e.sh` на изолированных DB/Redis/API | exit 0: capture/method/receipt, duplicate webhook, pre-delivery + 7-day + admin refunds |
| реальный restart API + повтор исходного checkout idempotency key | тот же subscription ID, 3 покупки и ровно 30 service days; повторного списания/продления нет |
| backend format/lint/typecheck/test/build (Этап 4) | exit 0; 34 unit/contract tests, включая pricing order, ledger replay и referral tier |
| admin lint/typecheck/build + mobile format/analyze/test (Этап 4) | exit 0; production build, Flutter no issues/widget passed |
| clean PostgreSQL migrate deploy + migrate diff | 12 migrations с нуля; `No difference detected` |
| `./scripts/verify-stage4-e2e.sh` на отдельной DB/API | referral registration/payment, duplicate webhook, promo→bonus→cash, 100% bonus без bank attempt, mixed recurring add-on, transfer и idempotent partial refund; exit 0 |
| Stage 4 worker startup | `worker.ready`; PaymentModule/LoyaltyModule DI и recurring reconciliation initialized |
| Stage 5 backend unit/build + `./scripts/verify-stage5-e2e.sh` | 41 tests; polygon/max-5, delayed READY dispatch, one provider attempt after retry, failed≠delivered and event dedupe; exit 0 |
| Stage 6 backend format/lint/typecheck/test/build | exit 0; 46 tests in 12 files, including unit conversion, weighted average and incompatible variant identity |
| Stage 6 Prisma deploy + diff | migration applied successfully; schema diff is empty |
| `./scripts/verify-stage6-e2e.sh` | exit 0: separate variants, repeat-safe production and waste, cost identity, incomplete packing guard and real PDF response |
| Stage 6 Admin lint + production build | exit 0 on Next.js 16.3.5 |
| `./scripts/verify-stage9-e2e.sh` на чистом Compose project | exit 0; 16/16 real-API steps, duplicate callbacks/retries/refund replay safe |
| Stage 9 backup/restore drill | PostgreSQL count restored, post-backup probe removed, deleted MinIO object restored |
| BullMQ worker restart with 10-second maintenance | `worker.shutdown` → `worker.ready`; payment/subscription/refund/delivery/bonus/receipt counts unchanged |

## Известные ограничения окружения

- GitHub remote отсутствует, поэтому серверный GitHub Actions run физически не запускался; локальный эквивалент workflow прошёл полностью. После первого push проверить зелёный run без изменения команд.
- Локальный Node 25 не входит в engine-range части Nest CLI tooling; Docker и CI закреплены на Node 24 LTS.
- Android ARM64 debug APK собран через JBR Android Studio. В установленном SDK нет AVD/system image, поэтому фактический запуск на emulator/device недоступен; small-screen и visual states проверены Flutter widget/golden suite.
- Xcode/CocoaPods не готовы; iOS codebase сохранена, но iOS build/device run в этом окружении не выполнялись.
- Полный dev audit backend сообщает advisory в build tooling Nest CLI; pruned runtime image сообщает 0 vulnerabilities и не содержит devDependencies.
- Модель принтера этикеток не выбрана; проверены layout/PDF/preview/history, но не прямая аппаратная печать.

## Точка продолжения

Этапы 10–11 завершены локально; обычный stack оставлен healthy на API `18080` и Admin `13000`, потому что host port `8080` занят другим проектом. Для production остаются только явно перечисленные внешние owner inputs: инфраструктура/домен, SMS, acquiring/fiscalization/push/Yandex contracts и credentials, два реальных номера Super Admin, согласованная delivery-zone geometry, kitchen address, сотрудники/роли, утверждённые pricing/nutrition/loyalty/stock/analytics policies, бренд/store/legal материалы и конкретная модель принтера при необходимости прямой печати. Полный список с назначением, сроком и полем конфигурации находится в `docs/CLIENT_DATA_REQUEST.md`. До их получения production работает fail-closed, а local использует только явно помеченные simulators/layouts.
