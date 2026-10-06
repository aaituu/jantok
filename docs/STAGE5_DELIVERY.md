# Этап 5: адреса, daily fulfillment и доставка

## Граница агрегатов

`daily_orders` остаются participant meal orders. `daily_fulfillments` — household-level Daily Order: один на service day, со снимками адреса/слота, физическим status, независимым financial status, optimistic `version`, событиями, job и delivery attempts. Частичный уникальный индекс разрешает только одну попытку без `terminal_at`.

## Допустимые переходы

| Из | В | Инициатор | Условия и side effects | Audit / retry |
| --- | --- | --- | --- | --- |
| `SCHEDULED` | `LOCKED` | system finalizer | Наступил cutoff; редактирование даты/адреса закрыто | unique event; conditional update |
| `LOCKED` | `IN_PRODUCTION` | kitchen/staff | Оплата действительна, день не skip/pause | reason для staff; безопасный повтор по idempotency key |
| `IN_PRODUCTION` | `COOKED` | kitchen/staff | Производство завершено | append-only event |
| `COOKED` | `PACKING` | kitchen/staff | Передано в упаковку | append-only event |
| `PACKING` | `READY` | kitchen/staff | Household order полностью собран | создаётся persisted job, но provider ещё не вызывается |
| `READY` | `DELIVERY_CREATED` | system worker | `now >= dispatch_at`, нет другой активной попытки | стабильный request/idempotency key; retry/backoff |
| `DELIVERY_CREATED` | `COURIER_ASSIGNED` | provider reconciliation | authoritative status не старше сохранённого | provider event unique; polling retry |
| `COURIER_ASSIGNED` | `COURIER_PICKED_UP` | provider reconciliation | authoritative pickup status | provider event unique |
| `COURIER_PICKED_UP` | `ON_THE_WAY` | provider reconciliation | derived monotonic progress | append-only event |
| `ON_THE_WAY` | `ARRIVED` | provider reconciliation | authoritative arrival status | append-only event |
| `ARRIVED` | `DELIVERED` | provider/staff | authoritative delivery или staff exception с reason | terminal; регресс запрещён |
| active delivery states | `DELIVERY_FAILED` | provider/staff | authoritative failure или staff decision | terminal; не считается доставкой |
| assigned/on-way/arrived | `NO_ANSWER` | provider/staff | явное событие/решение | terminal; создаётся действие поддержки |
| `SCHEDULED` | `SKIPPED` / `CANCELLED` | system/staff | до lock; staff reason обязателен | terminal; job отсутствует/отменяется |

Произвольного `PATCH status` нет. Staff использует `POST /staff/daily-orders/:id/transitions` с permission, reason, expected version и idempotency key. Неизвестные provider statuses сохраняются как `IGNORED`; запоздавшие — `IGNORED_STALE`. Финальный физический статус не регрессирует.

## Provider mapping и доступность

Интерфейс содержит `calculateDelivery`, `createDelivery`, `cancelDelivery`, `getStatus`, `getCourier`, `getTracking`, `getETA`. Реализация `LOCAL_SIMULATOR` детерминирована и не выдумывает курьера, ETA или трек на карте. `UNCONFIGURED` закрывает production до договора.

Для будущего Yandex adapter используются только официальные методы, доступные конкретному договору Казахстана. Callback signature не выдумана: общая документация не подтверждает способ подписи для JANTOK. До договорного подтверждения callback/courier phone/location/tracking/ETA выключены; status получается polling с лимитом.

## Клиентский tracking contract

`GET /deliveries/daily-orders/:id/tracking` возвращает status, отдельный financial status, immutable snapshots и availability flags. Недоступные courier/tracking/ETA равны `null`; есть текстовый fallback. Если договор разрешит номер курьера, клиент запускает системный `tel:` dialer и перечитывает номер после переназначения — встроенного чата нет.
