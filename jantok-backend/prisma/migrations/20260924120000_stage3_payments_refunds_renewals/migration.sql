ALTER TYPE "purchase_status" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "purchase_status" ADD VALUE 'REFUNDED';
ALTER TYPE "payment_attempt_status" ADD VALUE 'PENDING';
ALTER TYPE "payment_attempt_status" ADD VALUE 'REQUIRES_ACTION';
ALTER TYPE "payment_attempt_status" ADD VALUE 'UNKNOWN';

-- Stage 2 made the simplified one-shot attempt fully append-only. Stage 3 needs
-- explicit pending/authoritative transitions while keeping financial identity
-- and terminal results immutable.
DROP TRIGGER "payment_attempts_append_only" ON "payment_attempts";
CREATE OR REPLACE FUNCTION enforce_payment_attempt_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment attempt cannot be deleted';
  END IF;
  IF NEW.purchase_id <> OLD.purchase_id OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.provider <> OLD.provider OR NEW.amount_kzt <> OLD.amount_kzt THEN
    RAISE EXCEPTION 'payment attempt financial identity is immutable';
  END IF;
  IF OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
    RAISE EXCEPTION 'provider operation id is immutable once assigned';
  END IF;
  IF OLD.payment_method_id IS NOT NULL AND NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id THEN
    RAISE EXCEPTION 'payment method is immutable once assigned';
  END IF;
  IF OLD.status IN ('CAPTURED', 'FAILED', 'CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal payment attempt is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TYPE "refund_status" AS ENUM ('REQUESTED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "refund_kind" AS ENUM ('BEFORE_FIRST_DELIVERY', 'UNUSED_WITHIN_WINDOW', 'ADMIN_COMPENSATION');
CREATE TYPE "receipt_status" AS ENUM ('EXPECTED', 'PROCESSING', 'ISSUED', 'FAILED', 'REFUND_EXPECTED', 'REFUND_ISSUED');
CREATE TYPE "provider_event_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');
CREATE TYPE "renewal_status" AS ENUM ('SCHEDULED', 'NOTICE_SENT', 'PAYMENT_PENDING', 'SUCCEEDED', 'RETRY_SCHEDULED', 'ACTION_REQUIRED', 'CANCELLED');
CREATE TYPE "bonus_entry_type" AS ENUM ('CREDIT', 'DEBIT', 'REVERSAL', 'LIABILITY');

CREATE TABLE "payment_methods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "household_id" UUID NOT NULL,
  "provider" VARCHAR(40) NOT NULL, "provider_customer_ref" VARCHAR(160),
  "provider_token_ref" VARCHAR(256) NOT NULL, "mandate_ref" VARCHAR(256),
  "brand" VARCHAR(32), "last4" CHAR(4), "expiry_month" INTEGER, "expiry_year" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true, "mandate_active" BOOLEAN NOT NULL DEFAULT false,
  "consented_at" TIMESTAMPTZ(3), "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_method_mask_check" CHECK ("last4" IS NULL OR "last4" ~ '^[0-9]{4}$'),
  CONSTRAINT "payment_method_expiry_check" CHECK ("expiry_month" IS NULL OR "expiry_month" BETWEEN 1 AND 12)
);
CREATE UNIQUE INDEX "payment_methods_provider_token_ref_key" ON "payment_methods"("provider_token_ref");
CREATE UNIQUE INDEX "payment_methods_mandate_ref_key" ON "payment_methods"("mandate_ref");
CREATE INDEX "payment_methods_household_id_active_idx" ON "payment_methods"("household_id", "active");

ALTER TABLE "payment_attempts" ADD COLUMN "provider_event_time" TIMESTAMPTZ(3);
ALTER TABLE "payment_attempts" ADD COLUMN "payment_method_id" UUID;
CREATE TRIGGER "payment_attempt_transition_guard"
  BEFORE UPDATE OR DELETE ON "payment_attempts"
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_attempt_transition();
ALTER TABLE "purchases" ADD COLUMN "renewal_of_subscription_id" UUID;
CREATE INDEX "purchases_renewal_of_subscription_id_status_idx" ON "purchases"("renewal_of_subscription_id", "status");

CREATE TABLE "provider_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "provider" VARCHAR(40) NOT NULL,
  "provider_event_id" VARCHAR(160) NOT NULL, "provider_operation_id" VARCHAR(160),
  "event_type" VARCHAR(80) NOT NULL, "status" "provider_event_status" NOT NULL DEFAULT 'RECEIVED',
  "signature_valid" BOOLEAN NOT NULL, "payload_snapshot" JSONB NOT NULL, "result_snapshot" JSONB,
  "provider_occurred_at" TIMESTAMPTZ(3), "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "provider_webhook_events_provider_provider_event_id_key" ON "provider_webhook_events"("provider", "provider_event_id");
CREATE INDEX "provider_webhook_events_provider_operation_id_created_at_idx" ON "provider_webhook_events"("provider_operation_id", "created_at");

CREATE TABLE "refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "purchase_id" UUID NOT NULL, "payment_attempt_id" UUID,
  "idempotency_key" VARCHAR(128) NOT NULL, "provider_refund_reference" VARCHAR(160),
  "kind" "refund_kind" NOT NULL, "status" "refund_status" NOT NULL DEFAULT 'REQUESTED',
  "cash_kzt" INTEGER NOT NULL, "bonus_kzt" INTEGER NOT NULL,
  "restored_service_days" INTEGER NOT NULL DEFAULT 0, "reason" VARCHAR(500) NOT NULL,
  "actor_user_id" UUID, "actor_employee_id" UUID, "policy_snapshot" JSONB NOT NULL,
  "provider_response_snapshot" JSONB, "authoritative_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_amounts_check" CHECK ("cash_kzt" >= 0 AND "bonus_kzt" >= 0 AND ("cash_kzt" + "bonus_kzt") > 0),
  CONSTRAINT "refund_actor_check" CHECK (("actor_user_id" IS NOT NULL)::integer + ("actor_employee_id" IS NOT NULL)::integer = 1)
);
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");
CREATE UNIQUE INDEX "refunds_provider_refund_reference_key" ON "refunds"("provider_refund_reference");
CREATE INDEX "refunds_purchase_id_status_idx" ON "refunds"("purchase_id", "status");

CREATE TABLE "bonus_ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "household_id" UUID NOT NULL, "purchase_id" UUID,
  "refund_id" UUID, "reversal_of_id" UUID, "idempotency_key" VARCHAR(160) NOT NULL,
  "type" "bonus_entry_type" NOT NULL, "amount_kzt" INTEGER NOT NULL, "reason" VARCHAR(240) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bonus_ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bonus_ledger_amount_check" CHECK ("amount_kzt" > 0)
);
CREATE UNIQUE INDEX "bonus_ledger_entries_idempotency_key_key" ON "bonus_ledger_entries"("idempotency_key");
CREATE INDEX "bonus_ledger_entries_household_id_created_at_idx" ON "bonus_ledger_entries"("household_id", "created_at");

CREATE TABLE "receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "purchase_id" UUID NOT NULL, "refund_id" UUID,
  "idempotency_key" VARCHAR(160) NOT NULL, "status" "receipt_status" NOT NULL DEFAULT 'EXPECTED',
  "fiscal" BOOLEAN NOT NULL DEFAULT false, "provider" VARCHAR(40) NOT NULL,
  "external_document_ref" VARCHAR(256), "document_url" VARCHAR(1000), "document_snapshot" JSONB,
  "error_code" VARCHAR(80), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "receipts_idempotency_key_key" ON "receipts"("idempotency_key");
CREATE UNIQUE INDEX "receipts_external_document_ref_key" ON "receipts"("external_document_ref");
CREATE INDEX "receipts_status_created_at_idx" ON "receipts"("status", "created_at");

CREATE TABLE "payment_outbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aggregate_type" VARCHAR(50) NOT NULL, "aggregate_id" UUID NOT NULL,
  "event_type" VARCHAR(100) NOT NULL, "idempotency_key" VARCHAR(160) NOT NULL, "payload" JSONB NOT NULL,
  "status" "outbox_status" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "last_error" VARCHAR(1000),
  "processed_at" TIMESTAMPTZ(3), "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_outbox_idempotency_key_key" ON "payment_outbox"("idempotency_key");
CREATE INDEX "payment_outbox_status_next_attempt_at_idx" ON "payment_outbox"("status", "next_attempt_at");

CREATE TABLE "renewal_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "subscription_id" UUID NOT NULL, "payment_method_id" UUID NOT NULL,
  "cycle_end_date" DATE NOT NULL, "expected_charge_at" TIMESTAMPTZ(3) NOT NULL,
  "notification_due_at" TIMESTAMPTZ(3) NOT NULL, "notified_at" TIMESTAMPTZ(3), "price_kzt" INTEGER NOT NULL,
  "pricing_snapshot" JSONB NOT NULL, "terms_version" VARCHAR(80) NOT NULL,
  "status" "renewal_status" NOT NULL DEFAULT 'SCHEDULED', "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3, "next_attempt_at" TIMESTAMPTZ(3),
  "idempotency_key" VARCHAR(160) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "renewal_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "renewal_job_amount_check" CHECK ("price_kzt" >= 0 AND "max_attempts" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "renewal_jobs_idempotency_key_key" ON "renewal_jobs"("idempotency_key");
CREATE UNIQUE INDEX "renewal_jobs_subscription_id_cycle_end_date_key" ON "renewal_jobs"("subscription_id", "cycle_end_date");
CREATE INDEX "renewal_jobs_status_next_attempt_at_idx" ON "renewal_jobs"("status", "next_attempt_at");
CREATE INDEX "renewal_jobs_status_notification_due_at_idx" ON "renewal_jobs"("status", "notification_due_at");

CREATE TABLE "payment_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "version" INTEGER NOT NULL, "active" BOOLEAN NOT NULL DEFAULT false,
  "business_timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Almaty', "refund_window_calendar_days" INTEGER NOT NULL DEFAULT 7,
  "renewal_notice_days" INTEGER NOT NULL DEFAULT 4, "renewal_max_attempts" INTEGER NOT NULL DEFAULT 3,
  "renewal_retry_delay_hours" INTEGER NOT NULL DEFAULT 24, "terms_version" VARCHAR(80) NOT NULL DEFAULT 'local-v1',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "payment_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_settings_policy_check" CHECK ("refund_window_calendar_days" BETWEEN 1 AND 30 AND "renewal_notice_days" BETWEEN 3 AND 5 AND "renewal_max_attempts" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "payment_settings_version_key" ON "payment_settings"("version");

ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_renewal_of_subscription_id_fkey" FOREIGN KEY ("renewal_of_subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bonus_ledger_entries" ADD CONSTRAINT "bonus_ledger_entries_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bonus_ledger_entries" ADD CONSTRAINT "bonus_ledger_entries_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bonus_ledger_entries" ADD CONSTRAINT "bonus_ledger_entries_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bonus_ledger_entries" ADD CONSTRAINT "bonus_ledger_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "bonus_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "renewal_jobs" ADD CONSTRAINT "renewal_jobs_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "renewal_jobs" ADD CONSTRAINT "renewal_jobs_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "payment_settings" ("version", "active") VALUES (1, true);
