# Допущения и внешние зависимости

## Решения Этапов 0–1

- Существующий Flutter starter перенесён целиком из корня в `jantok-mobile/`; пользовательский код не пересоздавался поверх.
- Local Compose использует только явно отмеченные local credentials и persistent named volumes. Обычный `docker compose down` не удаляет данные.
- Телефоны нормализуются через `libphonenumber-js` в E.164 до записи; PostgreSQL дополнительно проверяет формат.
- В v1 допускаются только locales `kk`, `ru`, `en`, platforms `android`, `ios` и timezone `Asia/Almaty`.
- Household принадлежит одному user; список членов семьи не имеет искусственного лимита. Прогресс onboarding и анкеты хранится на сервере.
- DEMO nutrition rules и synthetic meals нужны только для local/test E2E и явно помечены `DEMO`; это не медицинские и не утверждённые детские нормы. Production выбирает только `APPROVED` rule sets.
- Global halal закреплён CHECK-ограничениями для ingredients/meals/add-ons; safety engine всё равно повторно проверяет invariant перед выбором.
- Worker обрабатывает настоящую системную BullMQ queue и завершает неизвестные jobs ошибкой; доменные processors добавляются вместе с доменами.

## Решения Этапа 2

- Локальные цены (`30 000/27 000/24 000/18 000 KZT`, guest `1 200 KZT/day`) являются исключительно `DEMO` fixtures для проверяемого расчёта. Они не являются бизнес-ценами и production их не выбирает.
- Service day в текущем v1-календаре — каждый последовательный календарный день. Праздничные/выходные производственные исключения должны публиковаться как отдельные календарные правила, а не скрываться в коде.
- Денежные значения округляются до целого KZT: prorate постоянного участника — `round(monthly × eligible_service_days / 30)`, затем отдельно округляется скидка basis points.
- До выбора платёжного провайдера cash checkout полностью работает только в local/test через явно маркированный `LOCAL_SIMULATOR`; production отвечает `PAYMENT_PROVIDER_NOT_CONFIGURED`. Нулевой cash checkout не создаёт банковскую попытку.
- Admin exception не обходит allergen/financial gates. Реализованы только операционные skip/free-day действия: обязательны permission, причина, append-only event, audit, пересчёт end date и staff task на уведомление клиента.

## Решения Этапа 3

- Платёжный и фискальный поставщики заказчиком не выбраны. `PaymentProvider` и `FiscalizationProvider` являются границами интеграции; в local/test используются детерминированные симуляторы, а staging/production остаются в режиме `unconfigured` до подключения адаптеров строго по официальной документации выбранных поставщиков.
- Local payment simulator немедленно возвращает авторитетный `CAPTURED`, но проходит тот же persisted pending → provider call → authoritative transition, что и будущий адаптер. Его operation/refund IDs детерминированы по idempotency key. Возврат из checkout по deep link только читает серверное состояние.
- В БД нет полей PAN/CVV. Сохраняются только opaque provider token/mandate identifiers и маскированные brand/last4/expiry metadata. Payload/snapshot симулятора также не содержит карточных реквизитов.
- Стандартное семидневное окно начинается с даты первой подтверждённой доставки и заканчивается в начале восьмого календарного дня в `Asia/Almaty` (верхняя граница исключительная). Значение и timezone версионируются в `payment_settings`.
- До первой доставки возвращается весь ещё не возвращённый cash/bonus остаток. Внутри окна cash и bonus независимо prorate-ятся по неиспользованным service days. Округление каждой части выполняется вниз до целого KZT, чтобы возврат никогда не превысил удержание.
- Административная компенсация не отменяет оставшиеся service days автоматически; стандартный добровольный refund отменяет неиспользованные дни и автопродление. Все бонусные корректировки append-only; история не удаляется.
- Симулятор чека создаёт только документ с явной маркировкой `TEST RECEIPT — NOT A FISCAL RECEIPT` и `fiscal=false`. Ошибка lifecycle чека не меняет успешный платёж.
- Renewal notice по умолчанию отправляется за 4 дня (допустимая настройка 3–5). Skip/pause переносит renewal job и сбрасывает старое уведомление. Если полное окно после нового уведомления не выдержано, списание переносится; retry ограничен настройкой и не создаёт новый provider operation ID.

## Решения Этапа 4

- `1 бонус = 1 KZT`, срок действия отсутствует, redemption допускается до 100%. Welcome 10% считается от cash-части первой успешной подписки после скидок; полностью бонусная покупка welcome не создаёт. Все параметры хранятся в versioned `loyalty_settings`; local fixtures имеют только статус `DEMO`.
- Один промокод на quote. Его использование и бонусы резервируются под PostgreSQL advisory lock household; истёкший/отменённый quote освобождает резервы append-only записью. Порядок расчёта: базовая и promo-скидки → bonus redemption → cash, итог не может быть отрицательным.
- Referral квалифицируется только первой реальной успешной покупкой приглашённого. Tier выбирается по новому числу квалифицированных друзей и применяется только к новому событию без пересчёта прошлых наград. Демо-сетка 1/3/5 и 2%/5%/10% не является production-default.
- CLUB считает только успешные 30-service-day циклы. Рабочая политика: любой частичный или полный refund снимает квалификацию цикла; это управляется `partial_refund_keeps_club_cycle`, по умолчанию `false`. Бесплатные/гостевые дни и возраст аккаунта циклы не добавляют.
- Reward, связанный с возвращаемой покупкой, сторнируется пропорционально совокупному refund компенсирующими ledger entries. При полном возврате referral qualification получает `REVERSED`.
- Recurring add-on хранит оплаченные/оставшиеся единицы и allocation на каждый service day; до authoritative confirmation allocations остаются `PENDING_PAYMENT`, skip/pause помечает прежнюю allocation `MOVED` и переносит ту же оплаченную единицу без нового списания. Bonus и cash части резервируются/подтверждаются через тот же provider boundary и стабильный idempotency key.

## Решения Этапа 5

- Существующий `daily_orders` хранит порцию конкретного member/guest. Чтобы не сломать это подтверждённое поведение, household-level исполнение моделируется отдельным `daily_fulfillments`: ровно один агрегат на `subscription_service_day`, включающий все порции и add-ons дня и допускающий не более одной активной `delivery_attempt`.
- Local/test использует неровный GeoJSON polygon `ASTANA_DEMO_V1`, явно помеченный `DEMO`; это не согласованная коммерческая зона. Production выбирает только `ACTIVE` geometry и без неё отклоняет операции. Проверка — point-in-polygon на backend, а не городская строка/bounding box. Ручной ввод не требует GPS телефона, но выбранная пользователем/поиском координата обязательна для серверной проверки и провайдера.
- Слоты 06:00–08:00, 07:00–09:00 и 08:00–10:00 бесплатны, не имеют capacity cap. Исторические `address_snapshot` и `slot_snapshot` не меняются после редактирования/soft-delete справочника. FK запрещает физическое удаление используемого слота без миграции.
- `READY` только создаёт persisted delivery job. Local demo dispatch lead — 45 минут до начала слота; production-значение должно быть утверждено в versioned settings. Worker не вызывает provider до `dispatch_at`. Timeout переводит тот же job в ограниченный retry с тем же idempotency key; reconciliation не создаёт новую заявку.
- Финансовое состояние (`PAID/PARTIALLY_REFUNDED/REFUNDED`) отделено от физического исполнения. Поэтому refund после `DELIVERED` не стирает факт доставки. `NO_ANSWER` и `DELIVERY_FAILED` являются отдельными terminal states и не преобразуются в `DELIVERED`; повторная доставка/компенсация требует staff command с permission, reason и append-only event.
- Generator создаёт агрегат идемпотентно по unique `service_day_id`. Finalization по рабочему допущению фиксирует заказ в 15:00 предыдущего календарного дня `Asia/Almaty`, согласованно с текущим Stage 2 cutoff; повторный worker run защищён conditional update и unique event key. Все изменения после этого используют optimistic `version`.
- Официальная документация Яндекс для доставки вне РФ описывает порядок `check-price` → `claims/create` → `claims/info` → `claims/accept`; `request_id` необходимо повторно использовать после 5xx/timeout, иначе возможен дубль курьера. `due` задаёт плановое время, а отсутствие `due` запускает поиск немедленно. Callback считается только ускорителем: authoritative reconciliation использует `claims/info` и `updated_ts`, чтобы игнорировать запоздавшее состояние.
- Наличие методов courier phone/location, tracking link, ETA и callback в общей документации не доказывает доступность по договору JANTOK в Казахстане. Все возможности выключены capability flags по умолчанию. Клиент получает `null` и честный fallback, а не сгенерированный ETA/координату. Номер курьера хранится только как обновляемый snapshot и должен перечитываться после переназначения.
- Официальные источники, проверенные 24.09.2026: [API quickstart](https://www.yandex.com/support/delivery-profile/en/api/express/quickstart), [claim creation/idempotency/due/callback](https://yandex.ru/support/delivery-profile/en/api/express/openapi/IntegrationV2ClaimsCreate), [claim lifecycle](https://yandex.ru/support/delivery-profile/en/api/express/claim-process), [API method list](https://yandex.ru/support/delivery-profile/en/api/express/openapi/), [FAQ](https://yandex.com/support/delivery-profile/en/api/express/faq), [Go Delivery API access](https://yandex.ru/dev/logistics/api-go-delivery/).

## Решения Этапа 6

- Одна физическая кухня и несколько мест хранения внутри неё. `TRANSFER` перемещает остаток между storage locations и не вводит multi-kitchen routing.
- Каноническая единица задаётся ингредиентом. Разрешены точные `g↔kg`, `ml↔l` и count conversions; mass↔volume требует сохранённой положительной density. Неизвестное преобразование отклоняется до изменения остатков.
- Forecast является расчётом без складского эффекта. FINAL/DELTA создают signed reservation deltas; фактический расход возникает только при атомарном подтверждении production. Изменение после lock всегда новая ревизия и новые packing tasks, не правка старого snapshot.
- Weighted average пересчитывается только подтверждённой приёмкой. Расход хранит применённую unit cost и recipe snapshot; прошлые себестоимости не пересчитываются после новой закупки.
- Waste представлен отдельной business-записью и связан ровно с одним движением `WASTE`. Cost report читает waste cost только из `waste_entries`, поэтому движение не суммируется второй раз.
- Финансовый refund не означает физический `RETURN`. Возврат/корректировка склада — отдельная permission-protected команда с причиной, actor и новым immutable movement.
- Production line aggregation считает add-on самостоятельной строкой. Его ингредиенты не дублируются в recipe основного блюда. Несовместимые modifications/portion/restrictions входят в variant key; порядок элементов set-подобного snapshot на hash не влияет.
- Принтер не выбран. A4/100×150/58×40 PDF и HTML preview — проверенные layout artifacts, но не сертификация конкретного устройства. В label не включается полная анкета и QR отсутствует в v1.

## Решения Этапа 7

- RBAC проверяется на каждом staff endpoint по permission code; карта Admin Panel дополнительно скрывает недоступные разделы, но UI не считается границей безопасности. Детальные финансовые/customer exports требуют предметного permission сверх `exports.create`, а export job и download принадлежат создавшему employee.
- В production требуются два разных Super Admin из env. Снятие роли/деактивация последнего активного Super Admin отклоняется транзакционно. Роли и permission assignments не заменяются флагом `isAdmin`.
- `audit_logs` append-only не только на уровне API: migration ставит PostgreSQL triggers, запрещающие `UPDATE` и `DELETE`. Секретоподобные поля рекурсивно заменяются на `[REDACTED]`; request/correlation ID поступает из `x-request-id` или генерируется middleware.
- Отзыв создаётся только по `daily_order_line_id`, принадлежащему household автора и реально имеющему физическое состояние `DELIVERED`. Публичное API возвращает только инициалы имени, рейтинг, комментарий, locale и дату; телефон, возраст, household и nutrition/allergy данные не раскрываются.
- Support message сначала сохраняется в PostgreSQL и дедуплицируется уникальной парой `(thread_id, client_message_id)`, затем публикуется в Socket.IO room. Join room повторно проверяет ownership либо `support.manage`; reconnect загружает сообщения REST-запросом `after`, поэтому WebSocket не является источником истины.
- Push templates версионируются для `kk/ru/en`; service и marketing consents разделены. В lock-screen payload допускаются только route/entity/event identifiers, а шаблоны с медицинскими/nutrition терминами отклоняются. Local simulator детерминирован; production остаётся `unconfigured` до выбора FCM/APNs-compatible provider.
- System Settings хранит только версионированные business values со статусами `DEMO/DRAFT/APPROVED/RETIRED`. Ключи, похожие на secrets/tokens/credentials, отклоняются. Approved `CUTOFF.POLICY`, `PRICING.RULES` и `CLUB.LEVELS` атомарно проецируются в действующие доменные таблицы и сразу возвращаются `/config/runtime`; уже оплаченные snapshots не переписываются.
- Manual subscription использует явный `PurchaseStatus.COMPLIMENTARY` либо `PENDING`. Complimentary grant имеет нулевые cash/bonus amounts, `paid_at = null`, проверяемое основание и audit record; он не маскируется под успешный банковский платёж.
- Analytics читает только persisted domain rows. Период ограничен 366 днями, timezone фиксируется в результате. Detail export сохраняет filters/columns/units/currency/generated time, защищён ownership и permission scope, живёт 7 дней. Текст, начинающийся с `=`, `+`, `-`, `@`, получает ведущий apostrophe в CSV/XLSX.

## Решения Этапа 9

- Demo fixtures разделены на идемпотентный seed справочников/персон/ограниченных сотрудников и real-API сценарий `scripts/verify-stage9-e2e.sh`, который создаёт изменяемые финансовые, delivery, kitchen, support и refund состояния на чистом local/test окружении. Это предотвращает прямую вставку «успешных» платежей в обход application/provider boundary.
- Управляемое время для finalization/dispatch/refund разрешено только в `local/test`; при передаче такого параметра в production endpoint отвечает `404`. Обычная production-логика всегда использует серверное время.
- Local setup создаёт `.env` только при отсутствии, генерирует независимые случайные secrets и одинаковую пару MinIO root/S3 credentials. Уже существующий `.env` не изменяется. Обычный `start/stop` не удаляет named volumes.
- Backup является согласованным операционным snapshot при остановленных writers: PostgreSQL custom dump плюс полный архив MinIO volume и manifest. Restore требует `APP_ENV=local|test`, явный флаг подтверждения и должен проверяться в отдельном Compose project.
- Local simulators являются явными adapters, а не fallback: `local` запрещён environment validation в production; `unconfigured` fail-closed режим не подменяет недоступный внешний сервис успешной операцией.
- Admin использует bearer auth, поэтому cookie-CSRF не является активным путём; если в будущем появится cookie-auth, CSRF token/SameSite policy станет обязательной до включения.

## Внешние зависимости

- Номера двух production Super Admin не предоставлены; production startup требует два разных E.164 номера. Local RBAC проверяется на синтетических номерах из отдельной env.
- Реальный SMS/OTP provider и его API contract/credentials не предоставлены. Полностью рабочий local adapter и закрытый dev-inbox реализованы; production startup с local mode запрещён и без выбранного adapter намеренно невозможен.
- Реальные payment/acquiring и fiscalization providers, merchant accounts, webhook verification contract и credentials не предоставлены. Payment domain, persistence, симуляторы и contract tests готовы; production cash checkout намеренно отвечает `PAYMENT_PROVIDER_NOT_CONFIGURED`, пока бизнес не выберет поставщиков и не будут добавлены официальные adapters.
- Договор/аккаунт/API token Яндекс Доставки, подтверждённый набор методов для Казахстана и согласованная production-геометрия зоны Астаны не предоставлены. `DeliveryProvider`, persistence, scheduler, polling reconciliation, local simulator и contract tests готовы; production delivery остаётся `unconfigured` до добавления официального adapter.
- Модель/язык команд принтера этикеток не предоставлены. Прямая печать на устройство не заявлена; доступны сохранённые PDF/HTML, preview и повторная печать.
- Production push provider (FCM/APNs или агрегатор), проект приложения и credentials не предоставлены. Notification outbox, consent/template lifecycle, retry и local simulator готовы; production dispatch намеренно отвечает `PUSH_PROVIDER_NOT_CONFIGURED` до официального adapter.
- Домен/TLS certificate/VPS/provider accounts не созданы и не выдумываются; Nginx подготовлен как template.
- Android doctor всё ещё сообщает об отсутствующем `cmdline-tools` и не может подтвердить все licenses, однако установленного SDK/JDK/Gradle достаточно для проверенной arm64 dev debug APK-сборки Этапа 8. Полный Xcode и CocoaPods отсутствуют, поэтому iOS build/signing остаются непроверенными.
- Docker daemon был выключен при первом аудите, затем Docker Desktop запущен; обычный stack `jantok` сейчас работает с persistent volumes.
## Решения Этапа 8

- Kazakh is the initial mobile locale; the user can switch kk/ru/en without reinstalling or restarting.
- No approved logo, brand palette or licensed food photographs were supplied. The Stage 8 client therefore uses a temporary text wordmark, neutral centralized tokens and explicit image fallbacks.
- `jantok://payment-return` is the temporary cross-platform checkout callback. Production universal-link domains and platform association files require a confirmed business domain.
- Provider-specific push, maps and payment SDKs remain external integration decisions. Their private credentials are never mobile runtime settings.

## Решения Этапов 10–11

- `LOCAL_VERIFIED` означает пройденную воспроизводимую локальную проверку, а не production certification. Hosted CI, physical devices, iOS build и реальные providers выделяются отдельно.
- Runtime OpenAPI генерируется из controllers/DTO на `/api/docs-json`; ручная копия JSON не хранится, чтобы не расходиться с фактической сборкой.
- `docs/DATABASE.md` показывает logical ERD; точные 111 models/relations/constraints определяют Prisma schema и 15 migrations.
- CI workflow реализован, но зелёный GitHub-hosted run не заявляется без Git remote/push. Локально воспроизведены команды jobs и полный acceptance runner.
- Android APK build и device launch считаются разными facts. APK собран; emulator/physical device в этом environment отсутствуют. iOS source ready, но build/signing блокируются неполным Xcode и отсутствием owner signing assets.
- Все owner inputs собраны в `docs/CLIENT_DATA_REQUEST.md`. После их получения нужны config/provider adapter integration и retest, а не переписывание domain.
