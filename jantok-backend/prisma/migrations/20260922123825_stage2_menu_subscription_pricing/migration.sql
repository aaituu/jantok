-- CreateEnum
CREATE TYPE "business_rule_status" AS ENUM ('DEMO', 'DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "menu_publication_status" AS ENUM ('DRAFT', 'PUBLISHED', 'LOCKED');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('ACTIVE', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "purchase_status" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "payment_attempt_status" AS ENUM ('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "service_day_status" AS ENUM ('PLANNED', 'SKIPPED', 'PAUSED', 'DISPATCHED', 'DELIVERED', 'FAILED_HELD', 'CANCELLED', 'COMPENSATED');

-- CreateEnum
CREATE TYPE "service_day_event_type" AS ENUM ('PLAN', 'RESERVE', 'USE', 'TRANSFER', 'CANCEL', 'COMPENSATE');

-- AlterTable
ALTER TABLE "addons" ADD COLUMN     "price_kzt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stock_units" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ingredients" ADD COLUMN     "calories_per_100g" DECIMAL(9,3) NOT NULL DEFAULT 0,
ADD COLUMN     "carb_per_100g" DECIMAL(9,3) NOT NULL DEFAULT 0,
ADD COLUMN     "fat_per_100g" DECIMAL(9,3) NOT NULL DEFAULT 0,
ADD COLUMN     "protein_per_100g" DECIMAL(9,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "meals" ADD COLUMN     "photo_url" VARCHAR(1000),
ADD COLUMN     "rating_average" DECIMAL(3,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rating_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serving_weight_grams" DECIMAL(9,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "member_meal_selections" ADD COLUMN     "menu_option_id" UUID,
ADD COLUMN     "nutrition_snapshot" JSONB,
ADD COLUMN     "price_snapshot" JSONB,
ADD COLUMN     "recipe_snapshot" JSONB;

-- CreateTable
CREATE TABLE "cutoff_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "status" "business_rule_status" NOT NULL DEFAULT 'DRAFT',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Almaty',
    "menu_minutes" INTEGER NOT NULL DEFAULT 780,
    "payment_minutes" INTEGER NOT NULL DEFAULT 780,
    "skip_minutes" INTEGER NOT NULL DEFAULT 840,
    "address_minutes" INTEGER NOT NULL DEFAULT 840,
    "delivery_minutes" INTEGER NOT NULL DEFAULT 840,
    "standalone_addon_minutes" INTEGER NOT NULL DEFAULT 900,
    "kitchen_lock_minutes" INTEGER NOT NULL DEFAULT 905,
    "max_pause_calendar_days" INTEGER NOT NULL DEFAULT 30,
    "effective_from" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cutoff_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rule_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "status" "business_rule_status" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'KZT',
    "adult_monthly_kzt" INTEGER NOT NULL,
    "teen_monthly_kzt" INTEGER NOT NULL,
    "child_monthly_kzt" INTEGER NOT NULL,
    "infant_monthly_kzt" INTEGER NOT NULL,
    "second_member_discount_bps" INTEGER NOT NULL DEFAULT 0,
    "third_plus_discount_bps" INTEGER NOT NULL DEFAULT 0,
    "guest_day_kzt" INTEGER NOT NULL,
    "effective_from" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_publications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_date" DATE NOT NULL,
    "status" "menu_publication_status" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "locked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_menu_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publication_id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "meal_type" "meal_type" NOT NULL,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "published_menu_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_allowed_additions" (
    "meal_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "amount_grams" DECIMAL(9,3) NOT NULL,
    "price_kzt" INTEGER NOT NULL,
    "stock_units" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "meal_allowed_additions_pkey" PRIMARY KEY ("meal_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "price_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "address_id" UUID NOT NULL,
    "pricing_rule_set_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "service_day_count" INTEGER NOT NULL DEFAULT 30,
    "subtotal_kzt" INTEGER NOT NULL,
    "discount_kzt" INTEGER NOT NULL,
    "bonus_kzt" INTEGER NOT NULL,
    "cash_kzt" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'KZT',
    "input_snapshot" JSONB NOT NULL,
    "breakdown_snapshot" JSONB NOT NULL,
    "status" "quote_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_quote_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "member_id" UUID,
    "kind" VARCHAR(40) NOT NULL,
    "description" VARCHAR(240) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_kzt" INTEGER NOT NULL,
    "total_kzt" INTEGER NOT NULL,
    "service_date" DATE,
    "details" JSONB NOT NULL,

    CONSTRAINT "price_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "status" "purchase_status" NOT NULL DEFAULT 'PENDING',
    "cash_kzt" INTEGER NOT NULL,
    "bonus_kzt" INTEGER NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchase_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_reference" VARCHAR(160),
    "amount_kzt" INTEGER NOT NULL,
    "status" "payment_attempt_status" NOT NULL DEFAULT 'CREATED',
    "authoritative_at" TIMESTAMPTZ(3),
    "response_snapshot" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "cutoff_policy_id" UUID NOT NULL,
    "status" "subscription_status" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "start_date" DATE NOT NULL,
    "current_end_date" DATE NOT NULL,
    "paid_service_days" INTEGER NOT NULL DEFAULT 30,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "pricing_snapshot" JSONB NOT NULL,
    "cutoff_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_guests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "nutrition_snapshot" JSONB NOT NULL,
    "allergy_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "member_id" UUID,
    "guest_id" UUID,
    "active_from" DATE NOT NULL,
    "active_to" DATE NOT NULL,
    "price_kzt" INTEGER NOT NULL,
    "pricing_snapshot" JSONB NOT NULL,

    CONSTRAINT "subscription_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_service_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "service_day_status" NOT NULL DEFAULT 'PLANNED',
    "transferred_from" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "subscription_service_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_day_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_day_id" UUID NOT NULL,
    "type" "service_day_event_type" NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "from_date" DATE,
    "to_date" DATE,
    "reason" VARCHAR(500),
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_day_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_pauses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "calendar_days" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_pauses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "service_day_id" UUID NOT NULL,
    "member_id" UUID,
    "service_date" DATE NOT NULL,
    "address_snapshot" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_order_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "meal_type" "meal_type" NOT NULL,
    "meal_snapshot" JSONB NOT NULL,
    "recipe_snapshot" JSONB NOT NULL,
    "modification_snapshot" JSONB NOT NULL,
    "nutrition_snapshot" JSONB NOT NULL,
    "price_snapshot" JSONB NOT NULL,

    CONSTRAINT "daily_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cutoff_policies_version_key" ON "cutoff_policies"("version");

-- CreateIndex
CREATE INDEX "cutoff_policies_status_effective_from_idx" ON "cutoff_policies"("status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rule_sets_version_key" ON "pricing_rule_sets"("version");

-- CreateIndex
CREATE INDEX "pricing_rule_sets_status_effective_from_idx" ON "pricing_rule_sets"("status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "menu_publications_service_date_key" ON "menu_publications"("service_date");

-- CreateIndex
CREATE INDEX "menu_publications_status_service_date_idx" ON "menu_publications"("status", "service_date");

-- CreateIndex
CREATE INDEX "published_menu_options_publication_id_meal_type_recommended_idx" ON "published_menu_options"("publication_id", "meal_type", "recommended");

-- CreateIndex
CREATE UNIQUE INDEX "published_menu_options_publication_id_meal_type_meal_id_key" ON "published_menu_options"("publication_id", "meal_type", "meal_id");

-- CreateIndex
CREATE INDEX "price_quotes_household_id_status_expires_at_idx" ON "price_quotes"("household_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "price_quote_lines_quote_id_kind_idx" ON "price_quote_lines"("quote_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_quote_id_key" ON "purchases"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_idempotency_key_key" ON "purchases"("idempotency_key");

-- CreateIndex
CREATE INDEX "purchases_household_id_status_idx" ON "purchases"("household_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_idempotency_key_key" ON "payment_attempts"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_reference_key" ON "payment_attempts"("provider_reference");

-- CreateIndex
CREATE INDEX "payment_attempts_purchase_id_status_idx" ON "payment_attempts"("purchase_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_purchase_id_key" ON "subscriptions"("purchase_id");

-- CreateIndex
CREATE INDEX "subscriptions_household_id_status_idx" ON "subscriptions"("household_id", "status");

-- CreateIndex
CREATE INDEX "subscription_guests_household_id_created_at_idx" ON "subscription_guests"("household_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_participants_subscription_id_member_id_key" ON "subscription_participants"("subscription_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_participants_subscription_id_guest_id_key" ON "subscription_participants"("subscription_id", "guest_id");

-- CreateIndex
CREATE INDEX "subscription_service_days_service_date_status_idx" ON "subscription_service_days"("service_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_service_days_subscription_id_service_date_key" ON "subscription_service_days"("subscription_id", "service_date");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_service_days_subscription_id_sequence_key" ON "subscription_service_days"("subscription_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "service_day_events_idempotency_key_key" ON "service_day_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "service_day_events_service_day_id_created_at_idx" ON "service_day_events"("service_day_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_pauses_idempotency_key_key" ON "subscription_pauses"("idempotency_key");

-- CreateIndex
CREATE INDEX "subscription_pauses_subscription_id_start_date_end_date_idx" ON "subscription_pauses"("subscription_id", "start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_orders_service_day_id_key" ON "daily_orders"("service_day_id");

-- CreateIndex
CREATE INDEX "daily_orders_service_date_status_idx" ON "daily_orders"("service_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_order_lines_order_id_meal_type_key" ON "daily_order_lines"("order_id", "meal_type");

-- AddForeignKey
ALTER TABLE "member_meal_selections" ADD CONSTRAINT "member_meal_selections_menu_option_id_fkey" FOREIGN KEY ("menu_option_id") REFERENCES "published_menu_options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_menu_options" ADD CONSTRAINT "published_menu_options_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "menu_publications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_menu_options" ADD CONSTRAINT "published_menu_options_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_allowed_additions" ADD CONSTRAINT "meal_allowed_additions_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_allowed_additions" ADD CONSTRAINT "meal_allowed_additions_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "household_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_quotes" ADD CONSTRAINT "price_quotes_pricing_rule_set_id_fkey" FOREIGN KEY ("pricing_rule_set_id") REFERENCES "pricing_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_quote_lines" ADD CONSTRAINT "price_quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "price_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_quote_lines" ADD CONSTRAINT "price_quote_lines_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "price_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_cutoff_policy_id_fkey" FOREIGN KEY ("cutoff_policy_id") REFERENCES "cutoff_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_guests" ADD CONSTRAINT "subscription_guests_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_participants" ADD CONSTRAINT "subscription_participants_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_participants" ADD CONSTRAINT "subscription_participants_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_participants" ADD CONSTRAINT "subscription_participants_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "subscription_guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_service_days" ADD CONSTRAINT "subscription_service_days_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_day_events" ADD CONSTRAINT "service_day_events_service_day_id_fkey" FOREIGN KEY ("service_day_id") REFERENCES "subscription_service_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_pauses" ADD CONSTRAINT "subscription_pauses_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_orders" ADD CONSTRAINT "daily_orders_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_orders" ADD CONSTRAINT "daily_orders_service_day_id_fkey" FOREIGN KEY ("service_day_id") REFERENCES "subscription_service_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_orders" ADD CONSTRAINT "daily_orders_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_order_lines" ADD CONSTRAINT "daily_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "daily_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain integrity not expressible in Prisma.
ALTER TABLE "cutoff_policies" ADD CONSTRAINT "cutoff_policy_values_check" CHECK (
  "timezone" = 'Asia/Almaty' AND
  "menu_minutes" BETWEEN 0 AND 1439 AND "payment_minutes" BETWEEN 0 AND 1439 AND
  "skip_minutes" BETWEEN 0 AND 1439 AND "address_minutes" BETWEEN 0 AND 1439 AND
  "delivery_minutes" BETWEEN 0 AND 1439 AND "standalone_addon_minutes" BETWEEN 0 AND 1439 AND
  "kitchen_lock_minutes" BETWEEN 0 AND 1439 AND "max_pause_calendar_days" > 0
);
ALTER TABLE "pricing_rule_sets" ADD CONSTRAINT "pricing_nonnegative_check" CHECK (
  "currency" = 'KZT' AND "adult_monthly_kzt" >= 0 AND "teen_monthly_kzt" >= 0 AND
  "child_monthly_kzt" >= 0 AND "infant_monthly_kzt" >= 0 AND "guest_day_kzt" >= 0 AND
  "second_member_discount_bps" BETWEEN 0 AND 10000 AND "third_plus_discount_bps" BETWEEN 0 AND 10000
);
ALTER TABLE "price_quotes" ADD CONSTRAINT "quote_amounts_check" CHECK (
  "service_day_count" = 30 AND "subtotal_kzt" >= 0 AND "discount_kzt" >= 0 AND
  "bonus_kzt" >= 0 AND "cash_kzt" >= 0 AND
  "cash_kzt" = "subtotal_kzt" - "discount_kzt" - "bonus_kzt"
);
ALTER TABLE "purchases" ADD CONSTRAINT "purchase_amounts_check" CHECK ("cash_kzt" >= 0 AND "bonus_kzt" >= 0);
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_amount_check" CHECK ("amount_kzt" > 0);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscription_days_check" CHECK ("paid_service_days" = 30 AND "current_end_date" >= "start_date");
ALTER TABLE "subscription_participants" ADD CONSTRAINT "participant_subject_check" CHECK (
  (("member_id" IS NOT NULL)::integer + ("guest_id" IS NOT NULL)::integer) = 1 AND
  "active_to" >= "active_from" AND "price_kzt" >= 0
);
ALTER TABLE "subscription_pauses" ADD CONSTRAINT "pause_range_check" CHECK (
  "end_date" >= "start_date" AND "calendar_days" = ("end_date" - "start_date") + 1
);
ALTER TABLE "meal_allowed_additions" ADD CONSTRAINT "addition_values_check" CHECK (
  "amount_grams" > 0 AND "price_kzt" >= 0 AND "stock_units" >= 0
);
CREATE UNIQUE INDEX "subscriptions_one_live_household_idx" ON "subscriptions"("household_id")
  WHERE "status" IN ('PENDING_PAYMENT', 'ACTIVE', 'PAUSED');
