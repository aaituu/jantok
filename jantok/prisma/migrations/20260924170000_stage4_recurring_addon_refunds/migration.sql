CREATE TABLE "recurring_addon_refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "status" "refund_status" NOT NULL DEFAULT 'REQUESTED',
  "units" INTEGER NOT NULL,
  "cash_kzt" INTEGER NOT NULL,
  "bonus_kzt" INTEGER NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "provider_refund_reference" VARCHAR(160),
  "provider_response_snapshot" JSONB,
  "finalized_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "recurring_addon_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_addon_refunds_values_check" CHECK (
    "units" > 0 AND "cash_kzt" >= 0 AND "bonus_kzt" >= 0 AND
    "cash_kzt" + "bonus_kzt" > 0
  )
);

CREATE UNIQUE INDEX "recurring_addon_refunds_idempotency_key_key" ON "recurring_addon_refunds"("idempotency_key");
CREATE UNIQUE INDEX "recurring_addon_refunds_provider_refund_reference_key" ON "recurring_addon_refunds"("provider_refund_reference");
CREATE INDEX "recurring_addon_refunds_plan_id_status_idx" ON "recurring_addon_refunds"("plan_id", "status");
ALTER TABLE "recurring_addon_refunds" ADD CONSTRAINT "recurring_addon_refunds_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "recurring_addon_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
