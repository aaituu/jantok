CREATE TYPE "subscription_change_type" AS ENUM ('PERMANENT_MEMBER', 'GUEST_DAYS');

DROP INDEX "daily_orders_service_day_id_key";
ALTER TABLE "daily_orders" ADD COLUMN "participant_id" UUID NOT NULL;

CREATE TABLE "subscription_change_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "type" "subscription_change_type" NOT NULL,
    "member_id" UUID,
    "guest_id" UUID,
    "service_dates" JSONB NOT NULL,
    "subtotal_kzt" INTEGER NOT NULL,
    "bonus_kzt" INTEGER NOT NULL,
    "cash_kzt" INTEGER NOT NULL,
    "breakdown_snapshot" JSONB NOT NULL,
    "status" "quote_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_change_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_change_quote_amounts_check" CHECK (
      "subtotal_kzt" >= 0 AND "bonus_kzt" >= 0 AND "cash_kzt" = "subtotal_kzt" - "bonus_kzt"
    ),
    CONSTRAINT "subscription_change_quote_subject_check" CHECK (
      (("member_id" IS NOT NULL)::integer + ("guest_id" IS NOT NULL)::integer) = 1
    )
);

CREATE TABLE "subscription_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "status" "purchase_status" NOT NULL DEFAULT 'PENDING',
    "cash_kzt" INTEGER NOT NULL,
    "bonus_kzt" INTEGER NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "subscription_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subscription_charge_amounts_check" CHECK ("cash_kzt" >= 0 AND "bonus_kzt" >= 0)
);

CREATE INDEX "subscription_change_quotes_subscription_id_status_expires_a_idx" ON "subscription_change_quotes"("subscription_id", "status", "expires_at");
CREATE UNIQUE INDEX "subscription_charges_quote_id_key" ON "subscription_charges"("quote_id");
CREATE UNIQUE INDEX "subscription_charges_idempotency_key_key" ON "subscription_charges"("idempotency_key");
CREATE UNIQUE INDEX "daily_orders_service_day_id_participant_id_key" ON "daily_orders"("service_day_id", "participant_id");

ALTER TABLE "daily_orders" ADD CONSTRAINT "daily_orders_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "subscription_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_change_quotes" ADD CONSTRAINT "subscription_change_quotes_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_change_quotes" ADD CONSTRAINT "subscription_change_quotes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_change_quotes" ADD CONSTRAINT "subscription_change_quotes_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "subscription_guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "subscription_change_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER accepted_subscription_change_quotes_immutable
  BEFORE UPDATE OR DELETE ON "subscription_change_quotes"
  FOR EACH ROW EXECUTE FUNCTION reject_accepted_quote_mutation();
