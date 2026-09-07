ALTER TABLE "jira_integrations" ADD COLUMN "schedule_minutes" integer;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD COLUMN "schedule_user_id" text;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD COLUMN "next_import_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD COLUMN "last_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD COLUMN "last_schedule_result" text;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD COLUMN "schedule_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD CONSTRAINT "jira_integrations_schedule_user_id_users_id_fk" FOREIGN KEY ("schedule_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;