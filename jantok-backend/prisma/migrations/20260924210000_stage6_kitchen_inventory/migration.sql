CREATE TYPE "inventory_dimension" AS ENUM ('MASS', 'VOLUME', 'COUNT');
CREATE TYPE "inventory_movement_type" AS ENUM ('PURCHASE', 'PRODUCTION', 'WASTE', 'CORRECTION', 'RETURN', 'TRANSFER');
CREATE TYPE "purchase_order_status" AS ENUM ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "production_revision_kind" AS ENUM ('FORECAST', 'FINAL', 'DELTA');
CREATE TYPE "production_revision_status" AS ENUM ('DRAFT', 'LOCKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "production_line_status" AS ENUM ('PLANNED', 'IN_PROGRESS', 'READY', 'ERROR');
CREATE TYPE "inventory_reservation_status" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED');
CREATE TYPE "packing_task_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'BLOCKED');
CREATE TYPE "packing_item_status" AS ENUM ('PENDING', 'PACKED', 'MISSING');
CREATE TYPE "print_document_type" AS ENUM ('PRODUCTION_LIST', 'PACKING_LIST', 'LABEL');

ALTER TABLE "daily_fulfillments" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "delivery_attempts" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "delivery_jobs" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "service_day_address_overrides" ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "ingredients"
  ADD COLUMN "critical_level" DECIMAL(16,3) NOT NULL DEFAULT 0,
  ADD COLUMN "density_grams_per_ml" DECIMAL(12,6),
  ADD COLUMN "inventory_category" VARCHAR(80) NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "inventory_dimension" "inventory_dimension" NOT NULL DEFAULT 'MASS',
  ADD COLUMN "inventory_unit" VARCHAR(16) NOT NULL DEFAULT 'g',
  ADD COLUMN "minimum_level" DECIMAL(16,3) NOT NULL DEFAULT 0;

ALTER TABLE "meals"
  ADD COLUMN "loss_factor" DECIMAL(8,5) NOT NULL DEFAULT 0,
  ADD COLUMN "recipe_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "yield_factor" DECIMAL(8,5) NOT NULL DEFAULT 1;

CREATE TABLE "storage_locations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "storage_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_balances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ingredient_id" UUID NOT NULL,
  "storage_location_id" UUID NOT NULL,
  "on_hand_quantity" DECIMAL(16,3) NOT NULL DEFAULT 0,
  "reserved_quantity" DECIMAL(16,3) NOT NULL DEFAULT 0,
  "average_cost_kzt" DECIMAL(16,6) NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_balances_nonnegative_check" CHECK ("on_hand_quantity" >= 0 AND "reserved_quantity" >= 0 AND "reserved_quantity" <= "on_hand_quantity"),
  CONSTRAINT "inventory_balances_cost_check" CHECK ("average_cost_kzt" >= 0)
);

CREATE TABLE "inventory_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ingredient_id" UUID NOT NULL,
  "type" "inventory_movement_type" NOT NULL,
  "quantity" DECIMAL(16,3) NOT NULL,
  "canonical_unit" VARCHAR(16) NOT NULL,
  "source_location_id" UUID,
  "target_location_id" UUID,
  "unit_cost_kzt" DECIMAL(16,6) NOT NULL,
  "total_cost_kzt" DECIMAL(18,2) NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "reference_type" VARCHAR(64) NOT NULL,
  "reference_id" VARCHAR(180) NOT NULL,
  "reason" VARCHAR(500),
  "actor_user_id" UUID,
  "shift_code" VARCHAR(80),
  "recipe_snapshot" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_movements_values_check" CHECK ("quantity" > 0 AND "unit_cost_kzt" >= 0 AND "total_cost_kzt" >= 0),
  CONSTRAINT "inventory_movements_location_check" CHECK ("source_location_id" IS NOT NULL OR "target_location_id" IS NOT NULL)
);

CREATE TABLE "suppliers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "contact_name" VARCHAR(160),
  "phone" VARCHAR(32),
  "email" VARCHAR(254),
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_purchases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "supplier_id" UUID NOT NULL,
  "number" VARCHAR(80) NOT NULL,
  "status" "purchase_order_status" NOT NULL DEFAULT 'DRAFT',
  "ordered_at" TIMESTAMPTZ(3),
  "received_at" TIMESTAMPTZ(3),
  "actor_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "supplier_purchases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_purchase_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purchase_id" UUID NOT NULL,
  "ingredient_id" UUID NOT NULL,
  "storage_location_id" UUID NOT NULL,
  "ordered_quantity" DECIMAL(16,3) NOT NULL,
  "received_quantity" DECIMAL(16,3) NOT NULL DEFAULT 0,
  "input_unit" VARCHAR(16) NOT NULL,
  "canonical_quantity" DECIMAL(16,3) NOT NULL,
  "unit_price_kzt" DECIMAL(16,6) NOT NULL,
  "received_at" TIMESTAMPTZ(3),
  "idempotency_key" VARCHAR(180),
  CONSTRAINT "supplier_purchase_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_purchase_items_quantity_check" CHECK ("ordered_quantity" > 0 AND "canonical_quantity" > 0 AND "received_quantity" >= 0 AND "received_quantity" <= "canonical_quantity" AND "unit_price_kzt" >= 0)
);

CREATE TABLE "waste_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ingredient_id" UUID NOT NULL,
  "movement_id" UUID NOT NULL,
  "quantity" DECIMAL(16,3) NOT NULL,
  "canonical_unit" VARCHAR(16) NOT NULL,
  "cost_kzt" DECIMAL(18,2) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "waste_date" DATE NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "shift_code" VARCHAR(80),
  "idempotency_key" VARCHAR(180) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "waste_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "waste_entries_values_check" CHECK ("quantity" > 0 AND "cost_kzt" >= 0)
);

CREATE TABLE "production_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "service_date" DATE NOT NULL,
  "revision" INTEGER NOT NULL,
  "kind" "production_revision_kind" NOT NULL,
  "status" "production_revision_status" NOT NULL DEFAULT 'DRAFT',
  "based_on_revision_id" UUID,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "locked_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "actor_user_id" UUID,
  "reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "production_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_revisions_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "production_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "revision_id" UUID NOT NULL,
  "line_kind" VARCHAR(16) NOT NULL DEFAULT 'MEAL',
  "item_id" UUID NOT NULL,
  "item_code" VARCHAR(80) NOT NULL,
  "variant_key" VARCHAR(64) NOT NULL,
  "portion_key" VARCHAR(80) NOT NULL,
  "planned_quantity" INTEGER NOT NULL,
  "actual_quantity" INTEGER,
  "status" "production_line_status" NOT NULL DEFAULT 'PLANNED',
  "item_snapshot" JSONB NOT NULL,
  "recipe_snapshot" JSONB NOT NULL,
  "modification_snapshot" JSONB NOT NULL,
  "restriction_snapshot" JSONB NOT NULL,
  "estimated_cost_kzt" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "actual_cost_kzt" DECIMAL(18,2),
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_lines_values_check" CHECK ("planned_quantity" > 0 AND ("actual_quantity" IS NULL OR "actual_quantity" >= 0) AND "estimated_cost_kzt" >= 0 AND ("actual_cost_kzt" IS NULL OR "actual_cost_kzt" >= 0))
);

CREATE TABLE "production_ingredient_needs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "revision_id" UUID NOT NULL,
  "ingredient_id" UUID NOT NULL,
  "required_quantity" DECIMAL(16,3) NOT NULL,
  "canonical_unit" VARCHAR(16) NOT NULL,
  "estimated_unit_cost_kzt" DECIMAL(16,6) NOT NULL,
  "estimated_total_kzt" DECIMAL(18,2) NOT NULL,
  "actual_quantity" DECIMAL(16,3),
  "actual_unit_cost_kzt" DECIMAL(16,6),
  "actual_total_kzt" DECIMAL(18,2),
  "recipe_snapshot" JSONB NOT NULL,
  CONSTRAINT "production_ingredient_needs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_ingredient_needs_values_check" CHECK ("required_quantity" >= 0 AND "estimated_unit_cost_kzt" >= 0 AND "estimated_total_kzt" >= 0 AND ("actual_quantity" IS NULL OR "actual_quantity" >= 0))
);

CREATE TABLE "inventory_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "revision_id" UUID NOT NULL,
  "ingredient_id" UUID NOT NULL,
  "storage_location_id" UUID NOT NULL,
  "quantity" DECIMAL(16,3) NOT NULL,
  "status" "inventory_reservation_status" NOT NULL DEFAULT 'ACTIVE',
  "idempotency_key" VARCHAR(180) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "production_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "revision_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "shift_code" VARCHAR(80),
  "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "total_cost_kzt" DECIMAL(18,2) NOT NULL,
  CONSTRAINT "production_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_runs_cost_check" CHECK ("total_cost_kzt" >= 0)
);

CREATE TABLE "packing_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "revision_id" UUID NOT NULL,
  "fulfillment_id" UUID NOT NULL,
  "household_snapshot" JSONB NOT NULL,
  "order_snapshot" JSONB NOT NULL,
  "status" "packing_task_status" NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "actor_user_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "packing_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "packing_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "packing_task_id" UUID NOT NULL,
  "daily_order_line_id" UUID,
  "item_type" VARCHAR(24) NOT NULL,
  "item_key" VARCHAR(180) NOT NULL,
  "member_snapshot" JSONB NOT NULL,
  "content_snapshot" JSONB NOT NULL,
  "restriction_label" VARCHAR(500),
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "status" "packing_item_status" NOT NULL DEFAULT 'PENDING',
  "packed_at" TIMESTAMPTZ(3),
  "packed_by_user_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "packing_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "packing_items_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "print_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" "print_document_type" NOT NULL,
  "revision_id" UUID,
  "packing_task_id" UUID,
  "reprint_of_id" UUID,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "file_name" VARCHAR(240) NOT NULL,
  "page_size" VARCHAR(40) NOT NULL,
  "content_snapshot" JSONB NOT NULL,
  "html_content" TEXT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "generated_by_user_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_documents_source_check" CHECK (("revision_id" IS NOT NULL)::int + ("packing_task_id" IS NOT NULL)::int = 1)
);

CREATE UNIQUE INDEX "storage_locations_code_key" ON "storage_locations"("code");
CREATE INDEX "inventory_balances_storage_location_id_on_hand_quantity_idx" ON "inventory_balances"("storage_location_id", "on_hand_quantity");
CREATE UNIQUE INDEX "inventory_balances_ingredient_id_storage_location_id_key" ON "inventory_balances"("ingredient_id", "storage_location_id");
CREATE UNIQUE INDEX "inventory_movements_idempotency_key_key" ON "inventory_movements"("idempotency_key");
CREATE INDEX "inventory_movements_ingredient_id_occurred_at_idx" ON "inventory_movements"("ingredient_id", "occurred_at");
CREATE INDEX "inventory_movements_reference_type_reference_id_idx" ON "inventory_movements"("reference_type", "reference_id");
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");
CREATE UNIQUE INDEX "supplier_purchases_number_key" ON "supplier_purchases"("number");
CREATE INDEX "supplier_purchases_supplier_id_status_idx" ON "supplier_purchases"("supplier_id", "status");
CREATE UNIQUE INDEX "supplier_purchase_items_idempotency_key_key" ON "supplier_purchase_items"("idempotency_key");
CREATE UNIQUE INDEX "supplier_purchase_items_purchase_id_ingredient_id_storage_l_key" ON "supplier_purchase_items"("purchase_id", "ingredient_id", "storage_location_id");
CREATE UNIQUE INDEX "waste_entries_movement_id_key" ON "waste_entries"("movement_id");
CREATE UNIQUE INDEX "waste_entries_idempotency_key_key" ON "waste_entries"("idempotency_key");
CREATE INDEX "waste_entries_waste_date_ingredient_id_idx" ON "waste_entries"("waste_date", "ingredient_id");
CREATE UNIQUE INDEX "production_revisions_idempotency_key_key" ON "production_revisions"("idempotency_key");
CREATE INDEX "production_revisions_service_date_status_idx" ON "production_revisions"("service_date", "status");
CREATE UNIQUE INDEX "production_revisions_service_date_revision_key" ON "production_revisions"("service_date", "revision");
CREATE INDEX "production_lines_revision_id_status_idx" ON "production_lines"("revision_id", "status");
CREATE UNIQUE INDEX "production_lines_revision_id_variant_key_key" ON "production_lines"("revision_id", "variant_key");
CREATE UNIQUE INDEX "production_ingredient_needs_revision_id_ingredient_id_key" ON "production_ingredient_needs"("revision_id", "ingredient_id");
CREATE UNIQUE INDEX "inventory_reservations_idempotency_key_key" ON "inventory_reservations"("idempotency_key");
CREATE INDEX "inventory_reservations_ingredient_id_status_idx" ON "inventory_reservations"("ingredient_id", "status");
CREATE UNIQUE INDEX "inventory_reservations_revision_id_ingredient_id_storage_lo_key" ON "inventory_reservations"("revision_id", "ingredient_id", "storage_location_id");
CREATE UNIQUE INDEX "production_runs_revision_id_key" ON "production_runs"("revision_id");
CREATE UNIQUE INDEX "production_runs_idempotency_key_key" ON "production_runs"("idempotency_key");
CREATE INDEX "packing_tasks_revision_id_status_idx" ON "packing_tasks"("revision_id", "status");
CREATE UNIQUE INDEX "packing_tasks_revision_id_fulfillment_id_key" ON "packing_tasks"("revision_id", "fulfillment_id");
CREATE INDEX "packing_items_packing_task_id_status_idx" ON "packing_items"("packing_task_id", "status");
CREATE UNIQUE INDEX "packing_items_packing_task_id_item_key_key" ON "packing_items"("packing_task_id", "item_key");
CREATE UNIQUE INDEX "print_documents_idempotency_key_key" ON "print_documents"("idempotency_key");
CREATE INDEX "print_documents_type_generated_at_idx" ON "print_documents"("type", "generated_at");

ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_source_location_id_fkey" FOREIGN KEY ("source_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_target_location_id_fkey" FOREIGN KEY ("target_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_purchases" ADD CONSTRAINT "supplier_purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_purchase_items" ADD CONSTRAINT "supplier_purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "supplier_purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_purchase_items" ADD CONSTRAINT "supplier_purchase_items_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_purchase_items" ADD CONSTRAINT "supplier_purchase_items_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "waste_entries" ADD CONSTRAINT "waste_entries_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "inventory_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_revisions" ADD CONSTRAINT "production_revisions_based_on_revision_id_fkey" FOREIGN KEY ("based_on_revision_id") REFERENCES "production_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "production_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_ingredient_needs" ADD CONSTRAINT "production_ingredient_needs_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "production_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_ingredient_needs" ADD CONSTRAINT "production_ingredient_needs_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "production_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_storage_location_id_fkey" FOREIGN KEY ("storage_location_id") REFERENCES "storage_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "production_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packing_tasks" ADD CONSTRAINT "packing_tasks_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "production_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packing_tasks" ADD CONSTRAINT "packing_tasks_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "daily_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_packing_task_id_fkey" FOREIGN KEY ("packing_task_id") REFERENCES "packing_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "packing_items" ADD CONSTRAINT "packing_items_daily_order_line_id_fkey" FOREIGN KEY ("daily_order_line_id") REFERENCES "daily_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_documents" ADD CONSTRAINT "print_documents_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "production_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_documents" ADD CONSTRAINT "print_documents_packing_task_id_fkey" FOREIGN KEY ("packing_task_id") REFERENCES "packing_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_documents" ADD CONSTRAINT "print_documents_reprint_of_id_fkey" FOREIGN KEY ("reprint_of_id") REFERENCES "print_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meals" ADD CONSTRAINT "meals_recipe_factors_check" CHECK ("recipe_version" > 0 AND "yield_factor" > 0 AND "loss_factor" >= 0);
ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_inventory_levels_check" CHECK ("minimum_level" >= 0 AND "critical_level" >= 0 AND ("density_grams_per_ml" IS NULL OR "density_grams_per_ml" > 0));
ALTER INDEX "delivery_provider_events_delivery_attempt_id_provider_updated_a" RENAME TO "delivery_provider_events_delivery_attempt_id_provider_updat_idx";
