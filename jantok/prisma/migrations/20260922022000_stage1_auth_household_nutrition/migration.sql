-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "onboarding_step" AS ENUM ('FAMILY', 'MEMBERS', 'ADDRESS', 'RECOMMENDATIONS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "goal_type" AS ENUM ('LOSE_WEIGHT', 'MAINTAIN', 'GAIN_WEIGHT', 'SPORT');

-- CreateEnum
CREATE TYPE "sport_intensity" AS ENUM ('NONE', 'LIGHT', 'MODERATE', 'HIGH');

-- CreateEnum
CREATE TYPE "portion_preference" AS ENUM ('RECOMMENDED', 'SMALL', 'STANDARD', 'LARGE');

-- CreateEnum
CREATE TYPE "allergy_declaration_status" AS ENUM ('NOT_ANSWERED', 'NONE', 'DECLARED');

-- CreateEnum
CREATE TYPE "preference_kind" AS ENUM ('PREFERRED', 'DISLIKED');

-- CreateEnum
CREATE TYPE "nutrition_rule_status" AS ENUM ('DEMO', 'DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "age_group" AS ENUM ('AGE_0_5', 'AGE_6_12', 'AGE_13_17', 'AGE_18_PLUS');

-- CreateEnum
CREATE TYPE "meal_type" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER');

-- CreateEnum
CREATE TYPE "meal_selection_status" AS ENUM ('SAFE', 'CONFLICT');

-- CreateEnum
CREATE TYPE "allergen_risk_type" AS ENUM ('CONTAINS', 'MAY_CONTAIN', 'CROSS_CONTACT');

-- CreateEnum
CREATE TYPE "staff_task_status" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- DropIndex
DROP INDEX "device_tokens_user_id_device_id_key";

-- Stage 0 exposes no user-writing API. Refuse to invent names or device identity
-- if this migration is accidentally run after business data was inserted manually.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users") OR EXISTS (SELECT 1 FROM "user_sessions") OR EXISTS (SELECT 1 FROM "device_tokens") THEN
    RAISE EXCEPTION 'stage1 migration requires empty auth tables; migrate existing records explicitly';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "device_tokens" ADD COLUMN     "encrypted_token" VARCHAR(2048) NOT NULL,
ADD COLUMN     "session_id" UUID NOT NULL,
ALTER COLUMN "device_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "households" ADD COLUMN     "onboarding_completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "onboarding_step" "onboarding_step" NOT NULL DEFAULT 'FAMILY';

-- AlterTable
ALTER TABLE "member_profiles" ADD COLUMN     "activity_level_id" UUID,
ADD COLUMN     "allergy_declaration_status" "allergy_declaration_status" NOT NULL DEFAULT 'NOT_ANSWERED',
ADD COLUMN     "diet_type_id" UUID,
ADD COLUMN     "goal" "goal_type",
ADD COLUMN     "portion_preference" "portion_preference" NOT NULL DEFAULT 'RECOMMENDED',
ADD COLUMN     "questionnaire_completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "sport_hours_per_week" DECIMAL(4,1) NOT NULL DEFAULT 0,
ADD COLUMN     "sport_intensity" "sport_intensity" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "sport_notes" VARCHAR(500);

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "device_id" VARCHAR(128) NOT NULL,
ADD COLUMN     "device_name" VARCHAR(160),
ADD COLUMN     "refresh_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "revocation_reason" VARCHAR(120),
ADD COLUMN     "updated_at" TIMESTAMPTZ(3) NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "first_name" VARCHAR(100) NOT NULL,
ADD COLUMN     "last_name" VARCHAR(100) NOT NULL;

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" VARCHAR(20) NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "device_id" VARCHAR(128) NOT NULL,
    "request_ip" INET NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "resend_after" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "used_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "used_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "city" VARCHAR(80) NOT NULL DEFAULT 'Астана',
    "street_address" VARCHAR(240) NOT NULL,
    "apartment" VARCHAR(32),
    "entrance" VARCHAR(32),
    "floor" VARCHAR(16),
    "intercom" VARCHAR(32),
    "delivery_instructions" VARCHAR(500),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "window_start" TIME(0),
    "window_end" TIME(0),
    "is_default" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "household_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name_kk" VARCHAR(120) NOT NULL,
    "name_ru" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "activity_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sport_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name_kk" VARCHAR(120) NOT NULL,
    "name_ru" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sport_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_sports" (
    "member_id" UUID NOT NULL,
    "sport_type_id" UUID NOT NULL,

    CONSTRAINT "member_sports_pkey" PRIMARY KEY ("member_id","sport_type_id")
);

-- CreateTable
CREATE TABLE "diet_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name_kk" VARCHAR(120) NOT NULL,
    "name_ru" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "requires_halal" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "diet_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,

    CONSTRAINT "ingredient_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diet_type_excluded_tags" (
    "diet_type_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "diet_type_excluded_tags_pkey" PRIMARY KEY ("diet_type_id","tag_id")
);

-- CreateTable
CREATE TABLE "allergens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name_kk" VARCHAR(120) NOT NULL,
    "name_ru" VARCHAR(120) NOT NULL,
    "name_en" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "allergens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_allergies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "allergen_id" UUID,
    "free_text" VARCHAR(500),
    "requires_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name_kk" VARCHAR(160) NOT NULL,
    "name_ru" VARCHAR(160) NOT NULL,
    "name_en" VARCHAR(160) NOT NULL,
    "is_halal" BOOLEAN NOT NULL DEFAULT true,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredient_allergens" (
    "ingredient_id" UUID NOT NULL,
    "allergen_id" UUID NOT NULL,

    CONSTRAINT "ingredient_allergens_pkey" PRIMARY KEY ("ingredient_id","allergen_id")
);

-- CreateTable
CREATE TABLE "ingredient_tag_links" (
    "ingredient_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "ingredient_tag_links_pkey" PRIMARY KEY ("ingredient_id","tag_id")
);

-- CreateTable
CREATE TABLE "member_food_preferences" (
    "member_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "kind" "preference_kind" NOT NULL,

    CONSTRAINT "member_food_preferences_pkey" PRIMARY KEY ("member_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "meals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "meal_type" "meal_type" NOT NULL,
    "is_halal" BOOLEAN NOT NULL DEFAULT true,
    "composition_verified" BOOLEAN NOT NULL DEFAULT false,
    "calories_kcal" INTEGER NOT NULL,
    "protein_grams" DECIMAL(7,2) NOT NULL,
    "fat_grams" DECIMAL(7,2) NOT NULL,
    "carb_grams" DECIMAL(7,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_translations" (
    "meal_id" UUID NOT NULL,
    "locale" VARCHAR(5) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "description" VARCHAR(1000),

    CONSTRAINT "meal_translations_pkey" PRIMARY KEY ("meal_id","locale")
);

-- CreateTable
CREATE TABLE "meal_ingredients" (
    "meal_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "amount" DECIMAL(12,3) NOT NULL,
    "unit" VARCHAR(24) NOT NULL,
    "removable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "meal_ingredients_pkey" PRIMARY KEY ("meal_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "meal_allergen_risks" (
    "meal_id" UUID NOT NULL,
    "allergen_id" UUID NOT NULL,
    "risk_type" "allergen_risk_type" NOT NULL,

    CONSTRAINT "meal_allergen_risks_pkey" PRIMARY KEY ("meal_id","allergen_id","risk_type")
);

-- CreateTable
CREATE TABLE "addons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name_kk" VARCHAR(160) NOT NULL,
    "name_ru" VARCHAR(160) NOT NULL,
    "name_en" VARCHAR(160) NOT NULL,
    "is_halal" BOOLEAN NOT NULL DEFAULT true,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_ingredients" (
    "addon_id" UUID NOT NULL,
    "ingredient_id" UUID NOT NULL,
    "amount" DECIMAL(12,3) NOT NULL,
    "unit" VARCHAR(24) NOT NULL,

    CONSTRAINT "addon_ingredients_pkey" PRIMARY KEY ("addon_id","ingredient_id")
);

-- CreateTable
CREATE TABLE "nutrition_rule_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL,
    "status" "nutrition_rule_status" NOT NULL DEFAULT 'DRAFT',
    "age_group" "age_group",
    "effective_from" TIMESTAMPTZ(3),
    "effective_to" TIMESTAMPTZ(3),
    "disclaimer_kk" VARCHAR(500) NOT NULL,
    "disclaimer_ru" VARCHAR(500) NOT NULL,
    "disclaimer_en" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_coefficients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rule_set_id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value" DECIMAL(14,6) NOT NULL,

    CONSTRAINT "nutrition_coefficients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_recommendations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "rule_set_id" UUID NOT NULL,
    "service_start_date" DATE NOT NULL,
    "age_group_snapshot" "age_group" NOT NULL,
    "input_snapshot" JSONB NOT NULL,
    "calories_kcal" INTEGER NOT NULL,
    "protein_grams" DECIMAL(7,2) NOT NULL,
    "fat_grams" DECIMAL(7,2) NOT NULL,
    "carb_grams" DECIMAL(7,2) NOT NULL,
    "recommended_portion" "portion_preference" NOT NULL,
    "allowed_meal_ids" JSONB NOT NULL,
    "blocked_meals" JSONB NOT NULL,
    "menu_proposal" JSONB NOT NULL,
    "requires_manual_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_meal_selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "meal_type" "meal_type" NOT NULL,
    "removed_ingredient_ids" JSONB NOT NULL,
    "added_ingredient_ids" JSONB NOT NULL,
    "addon_ids" JSONB NOT NULL,
    "status" "meal_selection_status" NOT NULL DEFAULT 'SAFE',
    "safety_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "member_meal_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" VARCHAR(20) NOT NULL,
    "user_id" UUID,
    "status" "employee_status" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(96) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_roles" (
    "employee_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_roles_pkey" PRIMARY KEY ("employee_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" UUID,
    "actor_employee_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" UUID,
    "old_values" JSONB,
    "new_values" JSONB,
    "reason" VARCHAR(500),
    "request_id" VARCHAR(80) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(80) NOT NULL,
    "status" "staff_task_status" NOT NULL DEFAULT 'OPEN',
    "member_id" UUID,
    "selection_id" UUID,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "staff_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_phone_created_at_idx" ON "otp_challenges"("phone", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_consumed_at_idx" ON "otp_challenges"("expires_at", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "used_refresh_tokens_token_hash_key" ON "used_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "used_refresh_tokens_expires_at_idx" ON "used_refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "household_addresses_household_id_deleted_at_idx" ON "household_addresses"("household_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_levels_code_key" ON "activity_levels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sport_types_code_key" ON "sport_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "diet_types_code_key" ON "diet_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ingredient_tags_code_key" ON "ingredient_tags"("code");

-- CreateIndex
CREATE UNIQUE INDEX "allergens_code_key" ON "allergens"("code");

-- CreateIndex
CREATE INDEX "member_allergies_member_id_requires_review_idx" ON "member_allergies"("member_id", "requires_review");

-- CreateIndex
CREATE UNIQUE INDEX "member_allergies_member_id_allergen_id_key" ON "member_allergies"("member_id", "allergen_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_code_key" ON "ingredients"("code");

-- CreateIndex
CREATE INDEX "member_food_preferences_member_id_kind_idx" ON "member_food_preferences"("member_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "meals_code_key" ON "meals"("code");

-- CreateIndex
CREATE INDEX "meals_meal_type_active_idx" ON "meals"("meal_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "addons_code_key" ON "addons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_rule_sets_version_key" ON "nutrition_rule_sets"("version");

-- CreateIndex
CREATE INDEX "nutrition_rule_sets_status_age_group_effective_from_idx" ON "nutrition_rule_sets"("status", "age_group", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "nutrition_coefficients_rule_set_id_key_key" ON "nutrition_coefficients"("rule_set_id", "key");

-- CreateIndex
CREATE INDEX "nutrition_recommendations_member_id_created_at_idx" ON "nutrition_recommendations"("member_id", "created_at");

-- CreateIndex
CREATE INDEX "member_meal_selections_service_date_status_idx" ON "member_meal_selections"("service_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "member_meal_selections_member_id_service_date_meal_type_key" ON "member_meal_selections"("member_id", "service_date", "meal_type");

-- CreateIndex
CREATE UNIQUE INDEX "employees_phone_key" ON "employees"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_occurred_at_idx" ON "audit_logs"("entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_employee_id_occurred_at_idx" ON "audit_logs"("actor_employee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "staff_tasks_status_type_created_at_idx" ON "staff_tasks"("status", "type", "created_at");

-- CreateIndex
CREATE INDEX "staff_tasks_member_id_status_idx" ON "staff_tasks"("member_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_session_id_device_id_key" ON "device_tokens"("session_id", "device_id");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_device_id_revoked_at_idx" ON "user_sessions"("user_id", "device_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "used_refresh_tokens" ADD CONSTRAINT "used_refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_addresses" ADD CONSTRAINT "household_addresses_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_activity_level_id_fkey" FOREIGN KEY ("activity_level_id") REFERENCES "activity_levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_diet_type_id_fkey" FOREIGN KEY ("diet_type_id") REFERENCES "diet_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_sports" ADD CONSTRAINT "member_sports_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_sports" ADD CONSTRAINT "member_sports_sport_type_id_fkey" FOREIGN KEY ("sport_type_id") REFERENCES "sport_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_type_excluded_tags" ADD CONSTRAINT "diet_type_excluded_tags_diet_type_id_fkey" FOREIGN KEY ("diet_type_id") REFERENCES "diet_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diet_type_excluded_tags" ADD CONSTRAINT "diet_type_excluded_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "ingredient_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_allergies" ADD CONSTRAINT "member_allergies_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_allergies" ADD CONSTRAINT "member_allergies_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_allergens" ADD CONSTRAINT "ingredient_allergens_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_allergens" ADD CONSTRAINT "ingredient_allergens_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_tag_links" ADD CONSTRAINT "ingredient_tag_links_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingredient_tag_links" ADD CONSTRAINT "ingredient_tag_links_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "ingredient_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_food_preferences" ADD CONSTRAINT "member_food_preferences_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_food_preferences" ADD CONSTRAINT "member_food_preferences_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_translations" ADD CONSTRAINT "meal_translations_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_allergen_risks" ADD CONSTRAINT "meal_allergen_risks_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_allergen_risks" ADD CONSTRAINT "meal_allergen_risks_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_ingredients" ADD CONSTRAINT "addon_ingredients_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_ingredients" ADD CONSTRAINT "addon_ingredients_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_coefficients" ADD CONSTRAINT "nutrition_coefficients_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "nutrition_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recommendations" ADD CONSTRAINT "nutrition_recommendations_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_recommendations" ADD CONSTRAINT "nutrition_recommendations_rule_set_id_fkey" FOREIGN KEY ("rule_set_id") REFERENCES "nutrition_rule_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_meal_selections" ADD CONSTRAINT "member_meal_selections_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_meal_selections" ADD CONSTRAINT "member_meal_selections_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "member_meal_selections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants which Prisma cannot express.
ALTER TABLE "otp_challenges"
  ADD CONSTRAINT "otp_phone_e164" CHECK (phone ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "otp_attempts_valid" CHECK (max_attempts > 0 AND attempts >= 0 AND attempts <= max_attempts),
  ADD CONSTRAINT "otp_times_valid" CHECK (expires_at > created_at AND resend_after > created_at);
ALTER TABLE "users" ADD CONSTRAINT "users_names_nonblank" CHECK (btrim(first_name) <> '' AND btrim(last_name) <> '');
ALTER TABLE "employees" ADD CONSTRAINT "employees_phone_e164" CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "user_sessions" ADD CONSTRAINT "sessions_refresh_version_valid" CHECK (refresh_version >= 0);
CREATE UNIQUE INDEX "user_sessions_one_active_device" ON "user_sessions" (user_id, device_id) WHERE revoked_at IS NULL;

ALTER TABLE "household_addresses"
  ADD CONSTRAINT "address_city_astana" CHECK (lower(btrim(city)) IN ('астана', 'astana')),
  ADD CONSTRAINT "address_coordinates_valid" CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
  ADD CONSTRAINT "address_window_valid" CHECK ((window_start IS NULL AND window_end IS NULL) OR (window_start IS NOT NULL AND window_end IS NOT NULL AND window_start < window_end));
CREATE UNIQUE INDEX "household_one_default_address" ON "household_addresses" (household_id) WHERE is_default AND deleted_at IS NULL;

ALTER TABLE "member_profiles"
  ADD CONSTRAINT "profile_measurements_valid" CHECK ((height_cm IS NULL OR height_cm > 0) AND (weight_kg IS NULL OR weight_kg > 0)),
  ADD CONSTRAINT "profile_sport_hours_valid" CHECK (sport_hours_per_week >= 0 AND sport_hours_per_week <= 168);
ALTER TABLE "member_allergies"
  ADD CONSTRAINT "member_allergy_source_valid" CHECK ((allergen_id IS NOT NULL) <> (nullif(btrim(free_text), '') IS NOT NULL)),
  ADD CONSTRAINT "member_allergy_free_text_review" CHECK (allergen_id IS NOT NULL OR requires_review);

ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_halal_only" CHECK (is_halal);
ALTER TABLE "meals"
  ADD CONSTRAINT "meals_halal_only" CHECK (is_halal),
  ADD CONSTRAINT "meals_nutrition_nonnegative" CHECK (calories_kcal >= 0 AND protein_grams >= 0 AND fat_grams >= 0 AND carb_grams >= 0);
ALTER TABLE "addons" ADD CONSTRAINT "addons_halal_only" CHECK (is_halal);
ALTER TABLE "meal_ingredients" ADD CONSTRAINT "meal_ingredient_amount_positive" CHECK (amount > 0);
ALTER TABLE "addon_ingredients" ADD CONSTRAINT "addon_ingredient_amount_positive" CHECK (amount > 0);
ALTER TABLE "nutrition_rule_sets" ADD CONSTRAINT "nutrition_rule_effective_range" CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from);
ALTER TABLE "nutrition_recommendations"
  ADD CONSTRAINT "recommendation_nutrition_positive" CHECK (calories_kcal > 0 AND protein_grams >= 0 AND fat_grams >= 0 AND carb_grams >= 0);

CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
