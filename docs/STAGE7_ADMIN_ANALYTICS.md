# Stage 7: Admin, RBAC, support, analytics

## Security boundaries

- Customer endpoints always derive household ownership from the authenticated user. A supplied thread, daily fulfillment or daily order line ID is never accepted without that check.
- Staff endpoints require an operation permission. `/staff/resources/:resource` performs a second resource/field-scope check; for example `exports.create` alone cannot expose Financial or Customers rows.
- Export downloads are available only to the creating employee while the job is `COMPLETED` and not expired.
- `audit_logs` is append-only in PostgreSQL. There is no update/delete API.

## Role defaults

`SUPER_ADMIN`, `ADMIN`, `KITCHEN_MANAGER`, `KITCHEN_WORKER`, `PACKING_WORKER`, `SUPPORT`, `MARKETING`, `FINANCE`, and `ANALYST` are bootstrapped idempotently. The permission list remains the source of truth and can be inspected in Admin Panel. Production bootstrap requires two distinct owner phones.

## Analytics definitions

Every `/staff/analytics/summary` response includes `period`, `timezone` and a `definitions` object. The current core formulas are:

- `revenueKzt`: sum of `purchase.cash_kzt` for authoritative paid/partially refunded/refunded purchases whose `paid_at` is in the period, before subtracting refunds.
- `refundsKzt`: sum of cash for `SUCCEEDED` refunds whose `authoritative_at` is in the period.
- `netRevenueKzt`: `revenueKzt - refundsKzt`.
- `averageSubscriptionCashKzt`: average cash portion of the same qualifying purchase set.
- bonuses issued/spent: positive/absolute negative immutable bonus ledger entries created in the period.
- active customers: active users whose household has an active subscription at query time.
- delivery breakdown: physical `daily_fulfillment.status` by service date. Financial status remains separate.
- kitchen plan/fact: sums of production line planned and actual quantities by production service date.
- waste cost: sum of `waste_entries.cost_kzt`; inventory movements are not summed again.

Accepted report types are `FINANCIAL`, `KITCHEN`, `INVENTORY`, `CUSTOMERS`, `SUBSCRIPTIONS`, `DELIVERY`, `WASTE`, and `MEALS`, in `CSV` or `XLSX`. Both formats contain generation metadata and apply spreadsheet-formula injection protection.

## Dynamic configuration

`GET /api/v1/config/runtime` is public configuration data intended for mobile clients. It returns only approved non-secret settings plus effective cutoff/pricing/CLUB/delivery projections. Admin writes a new immutable version through `POST /api/v1/staff/settings`; `APPROVED` cutoff, pricing and CLUB values take effect without rebuilding the Flutter app.
