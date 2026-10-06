CREATE TYPE "review_status" AS ENUM ('PUBLISHED', 'HIDDEN', 'DELETED');
CREATE TYPE "support_reason" AS ENUM ('NOT_DELIVERED', 'LATE', 'DAMAGED', 'TASTE', 'WRONG_MEAL', 'OTHER', 'POSITIVE_FEEDBACK');
CREATE TYPE "support_thread_status" AS ENUM ('OPEN', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_SUPPORT', 'RESOLVED', 'CLOSED');
CREATE TYPE "support_author_type" AS ENUM ('CUSTOMER', 'EMPLOYEE', 'SYSTEM');
CREATE TYPE "setting_status" AS ENUM ('DEMO', 'DRAFT', 'APPROVED', 'RETIRED');
CREATE TYPE "notification_template_status" AS ENUM ('DEMO', 'DRAFT', 'APPROVED', 'RETIRED');
CREATE TYPE "export_job_status" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');
CREATE TYPE "export_format" AS ENUM ('CSV', 'XLSX');

ALTER TYPE "purchase_status" ADD VALUE IF NOT EXISTS 'COMPLIMENTARY' AFTER 'PENDING';

ALTER TABLE "cutoff_policies" ADD COLUMN "service_days_per_cycle" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "meal_reviews"
  ADD COLUMN "daily_order_line_id" UUID,
  ADD COLUMN "status" "review_status" NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3);

UPDATE "meal_reviews" review
SET "daily_order_line_id" = (
  SELECT line.id
  FROM "daily_order_lines" line
  JOIN "daily_orders" order_row ON order_row.id = line.order_id
  WHERE order_row.member_id = review.member_id
    AND order_row.service_date = review.service_date
    AND line.meal_snapshot ->> 'id' = review.meal_id::text
  ORDER BY line.id
  LIMIT 1
);

CREATE UNIQUE INDEX "meal_reviews_daily_order_line_id_key" ON "meal_reviews"("daily_order_line_id");
ALTER TABLE "meal_reviews" ADD CONSTRAINT "meal_reviews_daily_order_line_id_fkey"
  FOREIGN KEY ("daily_order_line_id") REFERENCES "daily_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "review_moderations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "review_id" UUID NOT NULL,
  "actor_employee_id" UUID NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "old_status" "review_status" NOT NULL,
  "new_status" "review_status" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_moderations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "review_moderations_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "meal_reviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "review_moderations_actor_employee_id_fkey" FOREIGN KEY ("actor_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "review_moderations_review_id_created_at_idx" ON "review_moderations"("review_id", "created_at");

CREATE TABLE "support_threads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "household_id" UUID NOT NULL,
  "owner_user_id" UUID NOT NULL,
  "daily_fulfillment_id" UUID,
  "assigned_employee_id" UUID,
  "reason" "support_reason" NOT NULL,
  "positive" BOOLEAN NOT NULL DEFAULT false,
  "subject" VARCHAR(160) NOT NULL,
  "status" "support_thread_status" NOT NULL DEFAULT 'WAITING_FOR_SUPPORT',
  "customer_unread" INTEGER NOT NULL DEFAULT 0,
  "staff_unread" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_threads_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_threads_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_threads_daily_fulfillment_id_fkey" FOREIGN KEY ("daily_fulfillment_id") REFERENCES "daily_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_threads_assigned_employee_id_fkey" FOREIGN KEY ("assigned_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "support_threads_household_id_last_message_at_idx" ON "support_threads"("household_id", "last_message_at");
CREATE INDEX "support_threads_status_last_message_at_idx" ON "support_threads"("status", "last_message_at");

CREATE TABLE "support_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "thread_id" UUID NOT NULL,
  "author_type" "support_author_type" NOT NULL,
  "author_user_id" UUID,
  "author_employee_id" UUID,
  "client_message_id" VARCHAR(128) NOT NULL,
  "body" VARCHAR(4000) NOT NULL,
  "attachments" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "support_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_messages_author_employee_id_fkey" FOREIGN KEY ("author_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "support_messages_exactly_one_author" CHECK (
    ("author_type" = 'CUSTOMER' AND "author_user_id" IS NOT NULL AND "author_employee_id" IS NULL) OR
    ("author_type" = 'EMPLOYEE' AND "author_user_id" IS NULL AND "author_employee_id" IS NOT NULL) OR
    ("author_type" = 'SYSTEM' AND "author_user_id" IS NULL AND "author_employee_id" IS NULL)
  )
);
CREATE UNIQUE INDEX "support_messages_thread_id_client_message_id_key" ON "support_messages"("thread_id", "client_message_id");
CREATE INDEX "support_messages_thread_id_created_at_idx" ON "support_messages"("thread_id", "created_at");

CREATE TABLE "notification_preferences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "service_push_enabled" BOOLEAN NOT NULL DEFAULT true,
  "marketing_push_enabled" BOOLEAN NOT NULL DEFAULT false,
  "locale" VARCHAR(5) NOT NULL DEFAULT 'kk',
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

CREATE TABLE "notification_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_code" VARCHAR(80) NOT NULL,
  "locale" VARCHAR(5) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "notification_template_status" NOT NULL DEFAULT 'DRAFT',
  "title_template" VARCHAR(180) NOT NULL,
  "body_template" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_templates_event_code_locale_version_key" ON "notification_templates"("event_code", "locale", "version");
CREATE INDEX "notification_templates_event_code_locale_status_version_idx" ON "notification_templates"("event_code", "locale", "status", "version");

CREATE TABLE "notification_outbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "event_code" VARCHAR(80) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "service_message" BOOLEAN NOT NULL DEFAULT true,
  "locale" VARCHAR(5) NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider_message_id" VARCHAR(180),
  "last_error" VARCHAR(500),
  "sent_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "notification_outbox_idempotency_key_key" ON "notification_outbox"("idempotency_key");
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "notification_outbox"("status", "next_attempt_at");
CREATE INDEX "notification_outbox_user_id_created_at_idx" ON "notification_outbox"("user_id", "created_at");

CREATE TABLE "system_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "group_code" VARCHAR(64) NOT NULL,
  "key" VARCHAR(96) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "setting_status" NOT NULL DEFAULT 'DRAFT',
  "value" JSONB NOT NULL,
  "effective_at" TIMESTAMPTZ(3),
  "idempotency_key" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "system_settings_group_code_key_version_key" ON "system_settings"("group_code", "key", "version");
CREATE UNIQUE INDEX "system_settings_idempotency_key_key" ON "system_settings"("idempotency_key");
CREATE INDEX "system_settings_group_code_status_key_version_idx" ON "system_settings"("group_code", "status", "key", "version");

CREATE TABLE "export_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "creator_employee_id" UUID NOT NULL,
  "report_type" VARCHAR(32) NOT NULL,
  "format" "export_format" NOT NULL,
  "status" "export_job_status" NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "filters" JSONB NOT NULL,
  "columns" JSONB NOT NULL,
  "units" JSONB NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
  "row_count" INTEGER,
  "file_name" VARCHAR(240),
  "mime_type" VARCHAR(120),
  "file_data" BYTEA,
  "error_message" VARCHAR(500),
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "export_jobs_creator_employee_id_fkey" FOREIGN KEY ("creator_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "export_jobs_progress_check" CHECK ("progress" BETWEEN 0 AND 100)
);
CREATE INDEX "export_jobs_creator_employee_id_created_at_idx" ON "export_jobs"("creator_employee_id", "created_at");
CREATE INDEX "export_jobs_status_created_at_idx" ON "export_jobs"("status", "created_at");

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update"
BEFORE UPDATE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER "audit_logs_no_delete"
BEFORE DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
