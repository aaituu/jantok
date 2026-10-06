CREATE TABLE "meal_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meal_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(1000),
    "locale" VARCHAR(5) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meal_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "meal_reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "meal_reviews_locale_check" CHECK ("locale" IN ('kk','ru','en'))
);
CREATE INDEX "meal_reviews_meal_id_created_at_idx" ON "meal_reviews"("meal_id", "created_at");
CREATE UNIQUE INDEX "meal_reviews_meal_id_member_id_service_date_key" ON "meal_reviews"("meal_id", "member_id", "service_date");
ALTER TABLE "meal_reviews" ADD CONSTRAINT "meal_reviews_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meal_reviews" ADD CONSTRAINT "meal_reviews_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "household_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meal_reviews" ADD CONSTRAINT "meal_reviews_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
