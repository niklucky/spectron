ALTER TABLE "jira_integrations" ADD COLUMN "full_import_user_id" text;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD COLUMN "import_progress" jsonb;