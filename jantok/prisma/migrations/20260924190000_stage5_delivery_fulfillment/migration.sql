CREATE TYPE "delivery_config_status" AS ENUM ('DEMO', 'DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "daily_fulfillment_status" AS ENUM ('SCHEDULED', 'LOCKED', 'IN_PRODUCTION', 'COOKED', 'PACKING', 'READY', 'DELIVERY_CREATED', 'COURIER_ASSIGNED', 'COURIER_PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED', 'SKIPPED', 'CANCELLED', 'DELIVERY_FAILED', 'NO_ANSWER');
CREATE TYPE "daily_financial_status" AS ENUM ('UNPAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');
CREATE TYPE "delivery_attempt_status" AS ENUM ('CREATE_PENDING', 'CREATED', 'COURIER_ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED', 'NO_ANSWER', 'FAILED', 'CANCEL_PENDING', 'CANCELLED', 'UNKNOWN');
CREATE TYPE "delivery_job_status" AS ENUM ('SCHEDULED', 'PROCESSING', 'RETRY', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "delivery_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version" INTEGER NOT NULL,
  "status" "delivery_config_status" NOT NULL DEFAULT 'DRAFT',
  "business_timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Almaty',
  "max_saved_addresses" INTEGER NOT NULL DEFAULT 5,
  "dispatch_lead_minutes" INTEGER NOT NULL DEFAULT 45,
  "max_create_retries" INTEGER NOT NULL DEFAULT 3,
  "retry_base_seconds" INTEGER NOT NULL DEFAULT 60,
  "polling_interval_seconds" INTEGER NOT NULL DEFAULT 60,
  "provider_mode" VARCHAR(40) NOT NULL DEFAULT 'LOCAL_SIMULATOR',
  "contract_country" VARCHAR(2) NOT NULL DEFAULT 'KZ',
  "callback_enabled" BOOLEAN NOT NULL DEFAULT false,
  "courier_phone_enabled" BOOLEAN NOT NULL DEFAULT false,
  "courier_location_enabled" BOOLEAN NOT NULL DEFAULT false,
  "tracking_link_enabled" BOOLEAN NOT NULL DEFAULT false,
  "eta_enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_settings_policy_check" CHECK (
    "max_saved_addresses" BETWEEN 1 AND 20 AND
    "dispatch_lead_minutes" BETWEEN 0 AND 240 AND
    "max_create_retries" BETWEEN 1 AND 10 AND
    "retry_base_seconds" BETWEEN 10 AND 3600 AND
    "polling_interval_seconds" BETWEEN 10 AND 3600
  )
);
CREATE UNIQUE INDEX "delivery_settings_version_key" ON "delivery_settings"("version");

CREATE TABLE "delivery_zones" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "status" "delivery_config_status" NOT NULL DEFAULT 'DRAFT',
  "geometry" JSONB NOT NULL,
  "version" INTEGER NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_zone_geojson_check" CHECK (
    "geometry"->>'type' = 'Polygon' AND jsonb_typeof("geometry"->'coordinates') = 'array'
  )
);
CREATE UNIQUE INDEX "delivery_zones_code_key" ON "delivery_zones"("code");
CREATE UNIQUE INDEX "delivery_zones_version_status_key" ON "delivery_zones"("version", "status");

CREATE TABLE "delivery_slots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "start_minutes" INTEGER NOT NULL,
  "end_minutes" INTEGER NOT NULL,
  "status" "delivery_config_status" NOT NULL DEFAULT 'DRAFT',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "delivery_slots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_slot_time_check" CHECK (
    "start_minutes" >= 0 AND "end_minutes" <= 1440 AND "start_minutes" < "end_minutes"
  )
);
CREATE UNIQUE INDEX "delivery_slots_code_key" ON "delivery_slots"("code");

ALTER TABLE "household_addresses"
  ADD COLUMN "label" VARCHAR(80) NOT NULL DEFAULT 'Дом',
  ADD COLUMN "landmarks" VARCHAR(500),
  ADD COLUMN "delivery_slot_id" UUID,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "service_day_address_overrides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "household_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "service_day_id" UUID NOT NULL,
  "address_id" UUID NOT NULL,
  "delivery_slot_id" UUID NOT NULL,
  "address_snapshot" JSONB NOT NULL,
  "slot_snapshot" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_day_address_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "service_day_address_overrides_service_day_id_key" ON "service_day_address_overrides"("service_day_id");
CREATE INDEX "service_day_address_overrides_household_id_created_at_idx" ON "service_day_address_overrides"("household_id", "created_at");

CREATE TABLE "daily_fulfillments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "household_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "service_day_id" UUID NOT NULL,
  "service_date" DATE NOT NULL,
  "address_snapshot" JSONB NOT NULL,
  "slot_snapshot" JSONB NOT NULL,
  "dispatch_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "daily_fulfillment_status" NOT NULL DEFAULT 'SCHEDULED',
  "financial_status" "daily_financial_status" NOT NULL DEFAULT 'PAID',
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_fulfillments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "daily_fulfillments_service_day_id_key" ON "daily_fulfillments"("service_day_id");
CREATE INDEX "daily_fulfillments_service_date_status_idx" ON "daily_fulfillments"("service_date", "status");

ALTER TABLE "daily_orders" ADD COLUMN "daily_fulfillment_id" UUID;

CREATE TABLE "daily_fulfillment_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fulfillment_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "type" VARCHAR(64) NOT NULL,
  "from_status" "daily_fulfillment_status",
  "to_status" "daily_fulfillment_status",
  "actor_type" VARCHAR(24) NOT NULL,
  "actor_user_id" UUID,
  "reason" VARCHAR(500),
  "details" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_fulfillment_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "daily_fulfillment_events_idempotency_key_key" ON "daily_fulfillment_events"("idempotency_key");
CREATE INDEX "daily_fulfillment_events_fulfillment_id_created_at_idx" ON "daily_fulfillment_events"("fulfillment_id", "created_at");

CREATE TABLE "delivery_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fulfillment_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "provider_reference" VARCHAR(160),
  "status" "delivery_attempt_status" NOT NULL DEFAULT 'CREATE_PENDING',
  "provider_status" VARCHAR(80),
  "provider_updated_at" TIMESTAMPTZ(3),
  "courier_snapshot" JSONB,
  "tracking_snapshot" JSONB,
  "eta_snapshot" JSONB,
  "request_snapshot" JSONB NOT NULL,
  "response_snapshot" JSONB,
  "terminal_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "delivery_attempts_idempotency_key_key" ON "delivery_attempts"("idempotency_key");
CREATE UNIQUE INDEX "delivery_attempts_provider_reference_key" ON "delivery_attempts"("provider_reference");
CREATE UNIQUE INDEX "delivery_attempts_fulfillment_id_attempt_number_key" ON "delivery_attempts"("fulfillment_id", "attempt_number");
CREATE UNIQUE INDEX "delivery_attempts_one_active_per_fulfillment" ON "delivery_attempts"("fulfillment_id") WHERE "terminal_at" IS NULL;
CREATE INDEX "delivery_attempts_fulfillment_id_status_idx" ON "delivery_attempts"("fulfillment_id", "status");

CREATE TABLE "delivery_provider_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "delivery_attempt_id" UUID NOT NULL,
  "provider" VARCHAR(40) NOT NULL,
  "provider_event_id" VARCHAR(200) NOT NULL,
  "provider_status" VARCHAR(80) NOT NULL,
  "provider_updated_at" TIMESTAMPTZ(3) NOT NULL,
  "result" VARCHAR(32) NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_provider_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "delivery_provider_events_provider_provider_event_id_key" ON "delivery_provider_events"("provider", "provider_event_id");
CREATE INDEX "delivery_provider_events_delivery_attempt_id_provider_updated_at_idx" ON "delivery_provider_events"("delivery_attempt_id", "provider_updated_at");

CREATE TABLE "delivery_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fulfillment_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "dispatch_at" TIMESTAMPTZ(3) NOT NULL,
  "status" "delivery_job_status" NOT NULL DEFAULT 'SCHEDULED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "next_attempt_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(500),
  "locked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_jobs_retry_check" CHECK ("attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "delivery_jobs_fulfillment_id_key" ON "delivery_jobs"("fulfillment_id");
CREATE UNIQUE INDEX "delivery_jobs_idempotency_key_key" ON "delivery_jobs"("idempotency_key");
CREATE INDEX "delivery_jobs_status_dispatch_at_next_attempt_at_idx" ON "delivery_jobs"("status", "dispatch_at", "next_attempt_at");

ALTER TABLE "household_addresses" ADD CONSTRAINT "household_addresses_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_day_address_overrides" ADD CONSTRAINT "service_day_address_overrides_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_day_address_overrides" ADD CONSTRAINT "service_day_address_overrides_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_day_address_overrides" ADD CONSTRAINT "service_day_address_overrides_service_day_id_fkey" FOREIGN KEY ("service_day_id") REFERENCES "subscription_service_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_day_address_overrides" ADD CONSTRAINT "service_day_address_overrides_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "household_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_day_address_overrides" ADD CONSTRAINT "service_day_address_overrides_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_fulfillments" ADD CONSTRAINT "daily_fulfillments_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_fulfillments" ADD CONSTRAINT "daily_fulfillments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_fulfillments" ADD CONSTRAINT "daily_fulfillments_service_day_id_fkey" FOREIGN KEY ("service_day_id") REFERENCES "subscription_service_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_orders" ADD CONSTRAINT "daily_orders_daily_fulfillment_id_fkey" FOREIGN KEY ("daily_fulfillment_id") REFERENCES "daily_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "daily_fulfillment_events" ADD CONSTRAINT "daily_fulfillment_events_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "daily_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "daily_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_provider_events" ADD CONSTRAINT "delivery_provider_events_delivery_attempt_id_fkey" FOREIGN KEY ("delivery_attempt_id") REFERENCES "delivery_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "daily_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "delivery_settings" (
  "version", "status", "provider_mode", "callback_enabled", "courier_phone_enabled",
  "courier_location_enabled", "tracking_link_enabled", "eta_enabled"
) VALUES (1, 'DEMO', 'LOCAL_SIMULATOR', true, false, false, false, false);

INSERT INTO "delivery_zones" ("code", "name", "status", "geometry", "version")
VALUES (
  'ASTANA_DEMO_V1',
  'Astana local demo polygon — NOT production-approved',
  'DEMO',
  '{"type":"Polygon","coordinates":[[[71.20,51.10],[71.28,51.22],[71.55,51.21],[71.67,51.14],[71.56,51.03],[71.32,51.02],[71.20,51.10]]]}'::jsonb,
  1
);

INSERT INTO "delivery_slots" ("code", "name", "start_minutes", "end_minutes", "status", "sort_order") VALUES
  ('MORNING_0600_0800', '06:00–08:00', 360, 480, 'DEMO', 10),
  ('MORNING_0700_0900', '07:00–09:00', 420, 540, 'DEMO', 20),
  ('MORNING_0800_1000', '08:00–10:00', 480, 600, 'DEMO', 30);

UPDATE "household_addresses"
SET "delivery_slot_id" = (SELECT "id" FROM "delivery_slots" WHERE "code" = 'MORNING_0600_0800')
WHERE "delivery_slot_id" IS NULL;

INSERT INTO "permissions" ("code") VALUES ('daily_order.manage'), ('delivery.manage') ON CONFLICT ("code") DO NOTHING;
