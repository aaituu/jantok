# API, realtime, jobs и state transitions

## OpenAPI

NestJS генерирует OpenAPI 3.0 непосредственно из текущих controllers/DTO:

- UI: `/api/docs`
- JSON: `/api/docs-json`
- REST prefix: `/api/v1`

В проверенной сборке 2026-09-27 документ содержит **109 paths, 122 operations и 60 component schemas**. Проверить работающий локальный API:

```bash
curl -fsS http://localhost:8080/api/docs-json \
  | jq '{openapi, paths:(.paths|keys|length), operations:([.paths[]|to_entries[]]|length), schemas:(.components.schemas|keys|length)}'
```

JSON намеренно не хранится как вручную редактируемая копия: точный контракт выдаёт собранный backend. CI компилирует controllers/DTO, а `scripts/verify-stage11.sh` проверяет runtime OpenAPI, когда API доступен.

## Общие правила REST

- Bearer access JWT; refresh token вращается отдельным endpoint.
- Customer endpoints всегда повторно проверяют ownership household/resource.
- Staff endpoints требуют permission code на backend; скрытие раздела Admin не является защитой.
- DTO используют whitelist, неизвестные поля запрещены, JSON/form body ограничен 1 MiB.
- Mutating financial/operational commands принимают idempotency key либо имеют уникальный business key.
- `x-request-id` валидируется или создаётся сервером и возвращается в response header/error.
- Временные решения принимаются по server clock `Asia/Almaty`, а не timezone устройства.

Единый error envelope:

```json
{
  "error": {
    "code": "DOMAIN_CODE",
    "message": "Readable explanation",
    "details": {},
    "requestId": "correlation-id"
  }
}
```

Необработанные исключения логируются как `api.unhandled_error` и возвращают нейтральный `INTERNAL_ERROR`; exception не превращается в успешный HTTP response.

## Группы API

| Контур | Основные endpoints |
| --- | --- |
| Auth/sessions | `/auth/otp/*`, `/auth/refresh`, `/auth/sessions`, `/auth/device-tokens` |
| Household/onboarding | `/household`, `/household/members`, `/household/members/:id/questionnaire`, `/household/addresses` |
| Nutrition/menu | `/members/:id/recommendations`, `/menu`, `/meals`, `/members/:id/meal-selections` |
| Subscription | `/subscriptions/quotes`, `/subscriptions/checkout`, `/subscriptions/current`, pause/skip/member/guest/add-on quote/change endpoints |
| Payments | `/payments/checkout`, `/payments/history`, `/payments/methods`, `/payments/refunds`, provider return/webhook boundaries |
| Loyalty | `/loyalty/club`, `/loyalty/addons`; promo/referral/CLUB settings under staff API |
| Delivery | `/deliveries/config`, `/deliveries/daily-orders/:id/tracking`; staff generator/transition/maintenance |
| Reviews/support | `/reviews`, `/support/threads`, `/support/attachments`, `/support/notification-preferences` |
| Kitchen/inventory | `/staff/kitchen/production*`, packing, inventory, suppliers, purchases, waste, costs, print |
| Admin/RBAC | `/staff/me`, customers, employees, roles, resources, audit logs, settings |
| Analytics/exports | `/staff/dashboard`, `/staff/analytics/summary`, `/staff/analytics/exports*` |
| Health/runtime | `/health/live`, `/health/ready`, `/config/runtime` |

Полный список и DTO всегда смотреть в runtime OpenAPI.

## Realtime support

Socket.IO namespace: `/support`.

Authentication передаётся как `handshake.auth.token` или `Authorization: Bearer …`. Gateway проверяет JWT, session ID, срок/отзыв session и активность user. События:

| Direction | Event | Payload/результат |
| --- | --- | --- |
| client → server | `thread:join` | `{threadId}`; ownership для клиента или `support.manage` для staff |
| client → server | `message:send` | `threadId`, `clientMessageId`, `body`, optional attachment IDs |
| server → room | `message:created` | сохранённое сообщение |

PostgreSQL — источник истины. Сообщение сначала записывается и дедуплицируется `(thread_id, client_message_id)`, затем публикуется. После reconnect клиент читает историю REST-запросом; потеря WebSocket event не теряет сообщение.

Nginx staging template проксирует WebSocket upgrade. CORS использует тот же точный `CORS_ORIGINS`, что REST.

## BullMQ jobs

Queue: `system`. Worker — отдельный process `jantok-backend/src/worker.ts`.

| Job | Источник | Поведение |
| --- | --- | --- |
| `healthcheck` | diagnostic/manual | Возвращает `processedAt` и input; проверяет worker round trip |
| `payments.maintenance` | repeat scheduler | outbox, UNKNOWN/PENDING reconciliation, receipts, refunds, notices, renewals |
| `payments.reconcile` | persisted operation | выясняет состояние существующей provider operation; не создаёт новый charge ID |
| `payments.renewal` | renewal job | проверяет consent/mandate/notice/current end и выполняет bounded retry |
| `deliveries.maintenance` | repeat scheduler | generator/finalizer/dispatch/reconciliation ограниченными batches |
| `deliveries.dispatch` | persisted delivery job | вызывает provider только после `dispatch_at`, со стабильным idempotency key |

Повторные schedulers регистрируются через `upsertJobScheduler`. Business effect защищён уникальными ключами/transactions, поэтому restart/replay не означает повторный платёж, service day, courier или stock movement. Неизвестное имя job завершается ошибкой; failed jobs логируются `worker.job_failed`.

Notification outbox сейчас dispatchится permission-protected staff/maintenance operation через тот же persisted retry lifecycle; production provider остаётся `unconfigured` до подключения.

## State transitions

### Платёж

`CREATED → PENDING / REQUIRES_ACTION → CAPTURED`

Ветви: `UNKNOWN` после network ambiguity с последующим reconciliation; terminal `FAILED`/`CANCELLED`. Deep-link return только читает state. Подписка активируется исключительно после `CAPTURED` или внутреннего zero-cash расчёта.

### Refund и receipt

- Refund: `REQUESTED → PENDING → SUCCEEDED | FAILED | CANCELLED`.
- Receipt: `EXPECTED → PROCESSING → ISSUED | FAILED`; возвратный документ `REFUND_EXPECTED → REFUND_ISSUED | FAILED`.

Ошибка receipt не меняет платёж и не создаёт повторное списание. Повтор refund использует исходный idempotency key и проверяет доступный остаток.

### Subscription, service days и renewal

- Subscription: `PENDING_PAYMENT → ACTIVE ↔ PAUSED → COMPLETED | CANCELLED`.
- Service day: `PLANNED → DISPATCHED → DELIVERED`; отдельные terminal/ledger outcomes `SKIPPED`, `PAUSED`, `FAILED_HELD`, `CANCELLED`, `COMPENSATED`.
- Renewal: `SCHEDULED → NOTICE_SENT → PAYMENT_PENDING → SUCCEEDED`; bounded branch `RETRY_SCHEDULED`, `ACTION_REQUIRED`, `CANCELLED`.

Pause/skip переносит allocation и expected end, а не теряет оплаченный день. Изменение конца инвалидирует старое renewal notice/schedule.

### Daily Fulfillment и доставка

Основной путь:

`SCHEDULED → LOCKED → IN_PRODUCTION → COOKED → PACKING → READY → DELIVERY_CREATED → COURIER_ASSIGNED → COURIER_PICKED_UP → ON_THE_WAY → ARRIVED → DELIVERED`

Terminal alternatives: `SKIPPED`, `CANCELLED`, `DELIVERY_FAILED`, `NO_ANSWER`. Финансовый статус хранится отдельно: `UNPAID`, `PAID`, `PARTIALLY_REFUNDED`, `REFUNDED`. Точная таблица инициаторов/условий — `docs/STAGE5_DELIVERY.md`.

`READY` только создаёт persisted scheduled job; courier вызывается после `dispatch_at`. Неизвестный/старый provider event сохраняется, но не регрессирует terminal state.

### Production и packing

- Production revision: `DRAFT → LOCKED → IN_PROGRESS → COMPLETED`; явная ветвь `CANCELLED`.
- Production line: `PLANNED → IN_PROGRESS → READY`; ошибка — `ERROR`.
- Packing task: `PENDING → IN_PROGRESS → COMPLETE`; проблема — `BLOCKED`.
- Packing item: `PENDING → PACKED | MISSING`.

Packing `COMPLETE` и fulfillment `READY` запрещены, пока есть обязательная неполная позиция. Подтверждение production и stock movements выполняются атомарно и один раз.

## Simulator routes

Local OTP inbox, payment webhook simulator и delivery webhook simulator являются настоящими adapter boundaries для тестов, но закрыты environment guards. В production они возвращают 404 и backend отказывается стартовать с `local` provider modes или demo seed. Точный список — `docs/INTEGRATIONS.md`.
