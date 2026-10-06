CREATE TYPE "bonus_reservation_status" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');
CREATE TYPE "promo_mechanic" AS ENUM ('PERCENT_DISCOUNT', 'FIXED_DISCOUNT', 'BONUS_GRANT');
CREATE TYPE "reservation_status" AS ENUM ('RESERVED', 'CONFIRMED', 'RELEASED');
CREATE TYPE "referral_status" AS ENUM ('PENDING', 'QUALIFIED', 'REVERSED');

ALTER TYPE "bonus_entry_type" ADD VALUE 'RESERVE';
ALTER TYPE "bonus_entry_type" ADD VALUE 'RELEASE';
ALTER TYPE "bonus_entry_type" ADD VALUE 'REFUND';
ALTER TYPE "bonus_entry_type" ADD VALUE 'COMPENSATION';

ALTER TABLE "addons"
  ADD COLUMN "category_id" UUID,
  ADD COLUMN "composition_en" VARCHAR(1000),
  ADD COLUMN "composition_kk" VARCHAR(1000),
  ADD COLUMN "composition_ru" VARCHAR(1000),
  ADD COLUMN "description_en" VARCHAR(1000),
  ADD COLUMN "description_kk" VARCHAR(1000),
  ADD COLUMN "description_ru" VARCHAR(1000),
  ADD COLUMN "photo_url" VARCHAR(1000),
  ADD COLUMN "recurring_price_kzt" INTEGER,
  ADD COLUMN "unit" VARCHAR(32) NOT NULL DEFAULT 'piece';

ALTER TABLE "bonus_ledger_entries"
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "source_key" VARCHAR(160);
ALTER TABLE "users" ADD COLUMN "referral_code" VARCHAR(32);

CREATE TABLE "addon_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name_kk" VARCHAR(160) NOT NULL,
  "name_ru" VARCHAR(160) NOT NULL,
  "name_en" VARCHAR(160) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "addon_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bonus_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "household_id" UUID NOT NULL,
  "quote_id" UUID NOT NULL,
  "purchase_id" UUID,
  "amount_kzt" INTEGER NOT NULL,
  "status" "bonus_reservation_status" NOT NULL DEFAULT 'RESERVED',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "bonus_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bonus_reservations_amount_check" CHECK ("amount_kzt" > 0)
);

CREATE TABLE "loyalty_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version" INTEGER NOT NULL,
  "status" "business_rule_status" NOT NULL DEFAULT 'DRAFT',
  "welcome_bonus_bps" INTEGER NOT NULL DEFAULT 1000,
  "bonus_kzt_per_unit" INTEGER NOT NULL DEFAULT 1,
  "max_redemption_bps" INTEGER NOT NULL DEFAULT 10000,
  "welcome_base" VARCHAR(64) NOT NULL DEFAULT 'CASH_AFTER_DISCOUNTS',
  "allow_multiple_promos" BOOLEAN NOT NULL DEFAULT false,
  "partial_refund_keeps_club_cycle" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loyalty_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loyalty_settings_values_check" CHECK (
    "welcome_bonus_bps" BETWEEN 0 AND 10000 AND
    "max_redemption_bps" BETWEEN 0 AND 10000 AND
    "bonus_kzt_per_unit" = 1
  )
);

CREATE TABLE "promo_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "mechanic" "promo_mechanic" NOT NULL,
  "value" INTEGER NOT NULL,
  "status" "business_rule_status" NOT NULL DEFAULT 'DRAFT',
  "valid_from" TIMESTAMPTZ(3),
  "valid_to" TIMESTAMPTZ(3),
  "total_use_limit" INTEGER,
  "per_household_use_limit" INTEGER NOT NULL DEFAULT 1,
  "first_subscription_only" BOOLEAN NOT NULL DEFAULT false,
  "min_subtotal_kzt" INTEGER NOT NULL DEFAULT 0,
  "applicable_operations" JSONB NOT NULL,
  "applicable_product_codes" JSONB NOT NULL,
  "compatible_codes" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promo_codes_values_check" CHECK (
    "value" >= 0 AND "per_household_use_limit" > 0 AND
    ("total_use_limit" IS NULL OR "total_use_limit" > 0) AND
    "min_subtotal_kzt" >= 0 AND
    ("mechanic" <> 'PERCENT_DISCOUNT' OR "value" <= 10000) AND
    ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" > "valid_from")
  )
);

CREATE TABLE "promo_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "promo_code_id" UUID NOT NULL,
  "household_id" UUID NOT NULL,
  "quote_id" UUID NOT NULL,
  "purchase_id" UUID,
  "status" "reservation_status" NOT NULL DEFAULT 'RESERVED',
  "discount_kzt" INTEGER NOT NULL DEFAULT 0,
  "bonus_grant_kzt" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "promo_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "promo_reservations_amounts_check" CHECK ("discount_kzt" >= 0 AND "bonus_grant_kzt" >= 0)
);

CREATE TABLE "referral_tiers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "status" "business_rule_status" NOT NULL DEFAULT 'DRAFT',
  "min_qualified_referrals" INTEGER NOT NULL,
  "reward_bps" INTEGER NOT NULL,
  "reward_base" VARCHAR(64) NOT NULL DEFAULT 'INVITEE_CASH_AFTER_DISCOUNTS',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_tiers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referral_tiers_values_check" CHECK ("min_qualified_referrals" > 0 AND "reward_bps" BETWEEN 0 AND 10000)
);

CREATE TABLE "referrals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "referrer_user_id" UUID NOT NULL,
  "invitee_user_id" UUID NOT NULL,
  "referral_code_snapshot" VARCHAR(32) NOT NULL,
  "status" "referral_status" NOT NULL DEFAULT 'PENDING',
  "qualified_purchase_id" UUID,
  "tier_id" UUID,
  "reward_bps" INTEGER,
  "reward_kzt" INTEGER,
  "qualified_at" TIMESTAMPTZ(3),
  "reversed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referrals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referrals_no_self_check" CHECK ("referrer_user_id" <> "invitee_user_id"),
  CONSTRAINT "referrals_reward_check" CHECK (("reward_bps" IS NULL OR "reward_bps" BETWEEN 0 AND 10000) AND ("reward_kzt" IS NULL OR "reward_kzt" >= 0))
);

CREATE TABLE "club_tiers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name_kk" VARCHAR(120) NOT NULL,
  "name_ru" VARCHAR(120) NOT NULL,
  "name_en" VARCHAR(120) NOT NULL,
  "status" "business_rule_status" NOT NULL DEFAULT 'DRAFT',
  "threshold_paid_cycles" INTEGER NOT NULL,
  "bonus_multiplier_bps" INTEGER NOT NULL DEFAULT 10000,
  "benefits" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "club_tiers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "club_tiers_values_check" CHECK ("threshold_paid_cycles" >= 0 AND "bonus_multiplier_bps" >= 0)
);

CREATE TABLE "club_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "household_id" UUID NOT NULL,
  "tier_id" UUID,
  "qualifying_paid_cycles" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "club_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "club_memberships_cycles_check" CHECK ("qualifying_paid_cycles" >= 0)
);

CREATE TABLE "recurring_addon_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "household_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "participant_id" UUID,
  "addon_id" UUID NOT NULL,
  "quantity_per_day" INTEGER NOT NULL,
  "paid_units" INTEGER NOT NULL,
  "remaining_units" INTEGER NOT NULL,
  "unit_price_kzt" INTEGER NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recurring_addon_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_addon_plans_values_check" CHECK (
    "quantity_per_day" > 0 AND "paid_units" > 0 AND
    "remaining_units" BETWEEN 0 AND "paid_units" AND "unit_price_kzt" >= 0
  )
);

CREATE TABLE "recurring_addon_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_id" UUID NOT NULL,
  "service_day_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
  "moved_from_id" UUID,
  CONSTRAINT "recurring_addon_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_addon_allocations_quantity_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "addon_categories_code_key" ON "addon_categories"("code");
CREATE UNIQUE INDEX "bonus_reservations_quote_id_key" ON "bonus_reservations"("quote_id");
CREATE UNIQUE INDEX "bonus_reservations_purchase_id_key" ON "bonus_reservations"("purchase_id");
CREATE INDEX "bonus_reservations_household_id_status_expires_at_idx" ON "bonus_reservations"("household_id", "status", "expires_at");
CREATE UNIQUE INDEX "loyalty_settings_version_key" ON "loyalty_settings"("version");
CREATE INDEX "loyalty_settings_status_version_idx" ON "loyalty_settings"("status", "version");
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");
CREATE INDEX "promo_codes_status_valid_from_valid_to_idx" ON "promo_codes"("status", "valid_from", "valid_to");
CREATE UNIQUE INDEX "promo_reservations_quote_id_key" ON "promo_reservations"("quote_id");
CREATE UNIQUE INDEX "promo_reservations_purchase_id_key" ON "promo_reservations"("purchase_id");
CREATE INDEX "promo_reservations_promo_code_id_status_expires_at_idx" ON "promo_reservations"("promo_code_id", "status", "expires_at");
CREATE INDEX "promo_reservations_household_id_promo_code_id_status_idx" ON "promo_reservations"("household_id", "promo_code_id", "status");
CREATE UNIQUE INDEX "referral_tiers_code_key" ON "referral_tiers"("code");
CREATE INDEX "referral_tiers_status_min_qualified_referrals_idx" ON "referral_tiers"("status", "min_qualified_referrals");
CREATE UNIQUE INDEX "referrals_invitee_user_id_key" ON "referrals"("invitee_user_id");
CREATE UNIQUE INDEX "referrals_qualified_purchase_id_key" ON "referrals"("qualified_purchase_id");
CREATE INDEX "referrals_referrer_user_id_status_idx" ON "referrals"("referrer_user_id", "status");
CREATE UNIQUE INDEX "club_tiers_code_key" ON "club_tiers"("code");
CREATE INDEX "club_tiers_status_threshold_paid_cycles_idx" ON "club_tiers"("status", "threshold_paid_cycles");
CREATE UNIQUE INDEX "club_memberships_household_id_key" ON "club_memberships"("household_id");
CREATE INDEX "recurring_addon_plans_subscription_id_status_idx" ON "recurring_addon_plans"("subscription_id", "status");
CREATE INDEX "recurring_addon_allocations_service_day_id_status_idx" ON "recurring_addon_allocations"("service_day_id", "status");
CREATE UNIQUE INDEX "recurring_addon_allocations_plan_id_service_day_id_key" ON "recurring_addon_allocations"("plan_id", "service_day_id");
CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

ALTER TABLE "addons" ADD CONSTRAINT "addons_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "addon_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bonus_reservations" ADD CONSTRAINT "bonus_reservations_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bonus_reservations" ADD CONSTRAINT "bonus_reservations_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "price_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bonus_reservations" ADD CONSTRAINT "bonus_reservations_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_reservations" ADD CONSTRAINT "promo_reservations_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_reservations" ADD CONSTRAINT "promo_reservations_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_reservations" ADD CONSTRAINT "promo_reservations_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "price_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "promo_reservations" ADD CONSTRAINT "promo_reservations_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_fkey" FOREIGN KEY ("referrer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_invitee_user_id_fkey" FOREIGN KEY ("invitee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_qualified_purchase_id_fkey" FOREIGN KEY ("qualified_purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "referral_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "club_memberships" ADD CONSTRAINT "club_memberships_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "club_tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_addon_plans" ADD CONSTRAINT "recurring_addon_plans_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_addon_plans" ADD CONSTRAINT "recurring_addon_plans_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_addon_plans" ADD CONSTRAINT "recurring_addon_plans_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "subscription_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_addon_plans" ADD CONSTRAINT "recurring_addon_plans_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_addon_allocations" ADD CONSTRAINT "recurring_addon_allocations_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "recurring_addon_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "recurring_addon_allocations" ADD CONSTRAINT "recurring_addon_allocations_service_day_id_fkey" FOREIGN KEY ("service_day_id") REFERENCES "subscription_service_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
