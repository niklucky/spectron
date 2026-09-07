ALTER TABLE "issues" ADD COLUMN "estimate_time" integer;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "finish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_estimate_nonnegative" CHECK ("issues"."estimate_time" IS NULL OR "issues"."estimate_time" >= 0);--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_date_order" CHECK ("issues"."start_at" IS NULL OR "issues"."finish_at" IS NULL OR "issues"."finish_at" >= "issues"."start_at");