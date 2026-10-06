ALTER TABLE "payment_methods" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "receipts" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "refunds" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "renewal_jobs" ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "recurring_addon_plans"
  ADD COLUMN "idempotency_key" VARCHAR(128),
  ADD COLUMN "total_kzt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "bonus_kzt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cash_kzt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "provider_reference" VARCHAR(160),
  ADD COLUMN "provider_event_time" TIMESTAMPTZ(3),
  ADD COLUMN "payment_status" "payment_attempt_status" NOT NULL DEFAULT 'CREATED',
  ADD COLUMN "provider_response_snapshot" JSONB,
  ADD COLUMN "paid_at" TIMESTAMPTZ(3);

UPDATE "recurring_addon_plans"
SET "idempotency_key" = 'legacy:' || "id",
    "total_kzt" = "paid_units" * "unit_price_kzt",
    "bonus_kzt" = "paid_units" * "unit_price_kzt",
    "payment_status" = 'CAPTURED',
    "paid_at" = "created_at";

ALTER TABLE "recurring_addon_plans"
  ALTER COLUMN "idempotency_key" SET NOT NULL,
  ALTER COLUMN "total_kzt" DROP DEFAULT;

ALTER TABLE "recurring_addon_plans"
  ADD CONSTRAINT "recurring_addon_plans_money_check" CHECK (
    "total_kzt" >= 0 AND "bonus_kzt" >= 0 AND "cash_kzt" >= 0 AND
    "bonus_kzt" + "cash_kzt" = "total_kzt"
  );

CREATE UNIQUE INDEX "recurring_addon_plans_idempotency_key_key" ON "recurring_addon_plans"("idempotency_key");
CREATE UNIQUE INDEX "recurring_addon_plans_provider_reference_key" ON "recurring_addon_plans"("provider_reference");
CREATE INDEX "recurring_addon_plans_payment_status_created_at_idx" ON "recurring_addon_plans"("payment_status", "created_at");
