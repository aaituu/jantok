-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "member_status" AS ENUM ('ACTIVE', 'PAUSED', 'REMOVED');

-- CreateEnum
CREATE TYPE "biological_sex" AS ENUM ('FEMALE', 'MALE', 'UNSPECIFIED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" VARCHAR(20) NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "locale" VARCHAR(5) NOT NULL DEFAULT 'kk',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(128) NOT NULL,
    "user_agent" VARCHAR(512),
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "device_id" VARCHAR(128),
    "locale" VARCHAR(5) NOT NULL DEFAULT 'kk',
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "households" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_user_id" UUID NOT NULL,
    "name" VARCHAR(120),
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Almaty',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "household_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "birth_date" DATE,
    "status" "member_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "member_id" UUID NOT NULL,
    "biological_sex" "biological_sex" NOT NULL DEFAULT 'UNSPECIFIED',
    "height_cm" DECIMAL(5,2),
    "weight_kg" DECIMAL(6,2),
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_status_created_at_idx" ON "users"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_expires_at_idx" ON "user_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "user_sessions_expires_at_revoked_at_idx" ON "user_sessions"("expires_at", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_hash_key" ON "device_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_revoked_at_idx" ON "device_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_user_id_device_id_key" ON "device_tokens"("user_id", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "households_owner_user_id_key" ON "households"("owner_user_id");

-- CreateIndex
CREATE INDEX "household_members_household_id_status_idx" ON "household_members"("household_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "member_profiles_member_id_key" ON "member_profiles"("member_id");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "households" ADD CONSTRAINT "households_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks intentionally maintained as SQL because Prisma schema cannot express them.
ALTER TABLE "users"
  ADD CONSTRAINT "users_phone_e164_check" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "users_locale_check" CHECK ("locale" IN ('kk', 'ru', 'en')),
  ADD CONSTRAINT "users_version_check" CHECK ("version" >= 0);

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_expiry_check" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "user_sessions_revoke_time_check" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

ALTER TABLE "device_tokens"
  ADD CONSTRAINT "device_tokens_platform_check" CHECK ("platform" IN ('android', 'ios')),
  ADD CONSTRAINT "device_tokens_locale_check" CHECK ("locale" IN ('kk', 'ru', 'en'));

ALTER TABLE "households"
  ADD CONSTRAINT "households_timezone_check" CHECK ("timezone" = 'Asia/Almaty'),
  ADD CONSTRAINT "households_version_check" CHECK ("version" >= 0);

ALTER TABLE "household_members"
  ADD CONSTRAINT "household_members_name_check" CHECK (length(btrim("first_name")) > 0),
  ADD CONSTRAINT "household_members_birth_date_check" CHECK ("birth_date" IS NULL OR "birth_date" <= CURRENT_DATE),
  ADD CONSTRAINT "household_members_version_check" CHECK ("version" >= 0);

ALTER TABLE "member_profiles"
  ADD CONSTRAINT "member_profiles_height_check" CHECK ("height_cm" IS NULL OR "height_cm" > 0),
  ADD CONSTRAINT "member_profiles_weight_check" CHECK ("weight_kg" IS NULL OR "weight_kg" > 0),
  ADD CONSTRAINT "member_profiles_version_check" CHECK ("version" >= 0);
