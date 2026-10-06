ALTER TYPE "subscription_change_type" ADD VALUE 'STANDALONE_ADDON';

CREATE TABLE "standalone_addon_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subscription_id" UUID NOT NULL,
    "service_day_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "addon_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PLANNED',
    "addon_snapshot" JSONB NOT NULL,
    "price_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "standalone_addon_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "standalone_addon_orders_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "standalone_addon_orders_status_check" CHECK ("status" IN ('PLANNED','CANCELLED','FULFILLED'))
);
CREATE INDEX "standalone_addon_orders_subscription_id_status_service_day__idx" ON "standalone_addon_orders"("subscription_id", "status", "service_day_id");
CREATE UNIQUE INDEX "standalone_addon_orders_service_day_id_participant_id_addon_key" ON "standalone_addon_orders"("service_day_id", "participant_id", "addon_id");
ALTER TABLE "standalone_addon_orders" ADD CONSTRAINT "standalone_addon_orders_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standalone_addon_orders" ADD CONSTRAINT "standalone_addon_orders_service_day_id_fkey" FOREIGN KEY ("service_day_id") REFERENCES "subscription_service_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standalone_addon_orders" ADD CONSTRAINT "standalone_addon_orders_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "subscription_participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standalone_addon_orders" ADD CONSTRAINT "standalone_addon_orders_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
