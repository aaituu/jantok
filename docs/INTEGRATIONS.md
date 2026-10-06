# Внешние интеграции JANTOK

## Общий принцип

Внутренний domain не зависит от конкретного поставщика. Для внешней операции сначала сохраняются internal state/idempotency/outbox, затем вызывается adapter. После timeout система выясняет состояние той же provider operation и не создаёт безусловно новую.

Доступные сейчас режимы:

- `local` — детерминированный simulator/sink только для local/test;
- `unconfigured` — fail-closed adapter для staging/production до выбора поставщика;
- будущий provider-specific sandbox/production mode добавляется одновременно с adapter, официальным контрактом, credential validation и contract tests.

Тихого fallback с реального provider на simulator нет. Production запрещает `local`, demo seed и simulator routes.

## Матрица

| Интеграция | Реализовано сейчас | Production blocker |
| --- | --- | --- |
| SMS/OTP | `OtpProvider`, secure challenge/expiry/attempt/rate limits, local Redis inbox, `UnconfiguredOtpProvider` | поставщик, договор, sender/template rules, API credentials |
| Acquiring | `PaymentProvider`, local provider, webhook verification, reconciliation, token/mandate metadata, contract tests | выбранный банк/PSP, merchant account, API/webhook contract |
| Fiscalization | `FiscalizationProvider`, test non-fiscal documents, receipt lifecycle, manual real-document registration | выбранная ККМ/ОФД схема, account/keys, реквизиты и формат чека |
| Delivery | `DeliveryProvider`, scheduler, attempts/events/reconciliation, local simulator | договор Яндекс Доставки для Казахстана, token, capabilities и production zone |
| Push | `PushProvider`, templates/consents/outbox/retries, local sink | Firebase/FCM+APNs либо другой поставщик и credentials |
| Object storage | AWS S3-compatible client, private bucket, real upload, readiness, backup/restore | production bucket/endpoint/access policy/credentials |
| Realtime | Socket.IO `/support`, JWT/session/RBAC/ownership, Nginx WebSocket proxy | production domain/TLS only |
| Maps/tracking | honest provider fields/link/ETA/contact fallback | provider capability and, if required, selected map SDK/public IDs |
| Label printer | stored PDF/HTML layouts, preview/reprint/history | exact printer/model/driver only for direct hardware printing |

## SMS/OTP

Interface: `OtpProvider.send()` и local-only `readDevelopmentInbox()`.

Local mode сохраняет plaintext OTP в Redis только на TTL challenge и только для allowlisted synthetic phones. PostgreSQL хранит HMAC, а не код. Dev inbox требует отдельный header token.

Production adapter должен по официальной документации выбранного SMS provider:

1. передавать нормализованный E.164;
2. не логировать code/credentials;
3. различать accepted/provider failure/timeout;
4. применять согласованный sender/template;
5. иметь contract tests и production config validation.

Поставщик заказчиком не выбран, поэтому имена его credential fields не придуманы.

## Payments

`PaymentProvider` реализует:

- `createPayment` со стабильным idempotency key;
- `getPayment` для reconciliation;
- `refund`;
- `verifyWebhook` документированным способом adapter;
- opaque payment method token/mandate и только masked metadata.

PAN/CVV не входят в DTO/schema/logs/analytics. Checkout/SDK реального provider должен собирать их вне JANTOK.

Authoritative confirmation — provider server response, verified webhook или reconciliation. Browser/deep-link return не подтверждает платёж. Local webhook использует HMAC исключительно как контракт simulator; это не предположение о будущем банке.

До выбора PSP `PAYMENT_PROVIDER_MODE=unconfigured` является единственным безопасным production состоянием.

## Fiscalization

`FiscalizationProvider.issueSale()` и `issueRefund()` отделены от payment lifecycle. Local документ маркируется test/non-fiscal. Ошибка документа сохраняется как `FAILED`, не повторяет charge/refund.

Подключение требует решения бизнеса: поставщик, модель работы ККМ/ОФД, налоговые реквизиты, позиции/ставки, email/phone receipt rules и юридически допустимый способ коррекции. После этого adapter реализуется только по официальному контракту.

## Яндекс Доставка

Общий interface содержит `calculateDelivery`, `createDelivery`, `cancelDelivery`, `getStatus`, `getCourier`, `getTracking`, `getETA`. Не каждое поле считается доступным: capabilities включаются только после подтверждения договора JANTOK в Казахстане.

По официальной инструкции Yandex Delivery token обычно получают в личном кабинете на вкладке Integration после выдачи доступа менеджером: <https://yandex.com/support/delivery-profile/en/api/express/quickstart>. Наличие метода в общей документации не доказывает его доступность конкретному договору.

До договора:

- production adapter отсутствует намеренно;
- callback signature/webhook не выдумывается;
- используется polling contract с ограничениями только в simulator tests;
- ETA/contact/location остаются `null`, если provider их не дал;
- demo pickup/zone запрещены в production.

## Push

`PushProvider` получает user, localized title/body, безопасный route payload и idempotency key. Templates versioned для kk/ru/en; service и marketing consent разделены. Outbox сохраняет attempts/error/next retry/provider message ID.

Вероятный вариант — Firebase Cloud Messaging с APNs для iOS, но выбор не утверждён. Firebase project/service account создаются в Firebase console; официальная инструкция: <https://firebase.google.com/docs/admin/setup>. Server key/JSON хранится только в secret manager. APNs key создаётся владельцем Apple Developer account в Certificates, Identifiers & Profiles: <https://developer.apple.com/help/account/keys/create-a-private-key>.

Клиентские public configuration files добавляются только после создания проектов; private keys не попадают в Flutter bundle.

## Object storage

Backend использует S3-compatible API:

- readiness: `HeadBucket`;
- support attachment: private `PutObject` после MIME/signature/size/ownership validation;
- local: MinIO persistent volume;
- backup: полный storage snapshot вместе с PostgreSQL dump.

Production нужен отдельный private bucket и service account с минимальными правами. Public-read bucket не требуется.

## Realtime

Socket.IO не является отдельным источником данных: PostgreSQL сохраняет support message раньше emit. Это позволяет восстановиться после reconnect. Production edge должен проксировать HTTP Upgrade; пример находится в `infra/nginx/jantok.conf`.

## Provider adapter checklist

Новый adapter считается подключённым только когда одновременно выполнены:

1. официальный договор/документация и доступность для Казахстана подтверждены;
2. credential names добавлены в environment validation/examples без реальных значений;
3. secrets находятся вне Git/client bundle;
4. sandbox и production modes различаются;
5. signatures, timestamps, replay protection и idempotency соответствуют документации provider;
6. timeout использует lookup/reconciliation исходной operation;
7. contract tests проходят через тот же application boundary, что local simulator;
8. production не fallback-ит на fake provider;
9. health/metrics/logs не содержат payload secrets или PII;
10. runbook описывает rotation/revocation и incident response.

Все ещё требуемые данные перечислены единым списком в `docs/CLIENT_DATA_REQUEST.md`.
