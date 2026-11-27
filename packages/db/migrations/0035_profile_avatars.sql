ALTER TABLE "users" ADD COLUMN "avatar_data" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_avatar_url_idx" ON "users" USING btree ("image") WHERE "users"."avatar_data" is not null;