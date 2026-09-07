CREATE TABLE "external_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"local_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_comments" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_worklogs" ALTER COLUMN "worker_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "uploaded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "external_author_id" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "external_assignee_id" text;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "external_author_id" text;--> statement-breakpoint
ALTER TABLE "issue_worklogs" ADD COLUMN "external_worker_id" text;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD COLUMN "import_run_id" text;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD COLUMN "import_cancelled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "external_uploader_id" text;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_integration_id_jira_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."jira_integrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_identities" ADD CONSTRAINT "external_identities_local_user_id_users_id_fk" FOREIGN KEY ("local_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_identities_source_unique" ON "external_identities" USING btree ("integration_id","external_id");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_external_author_id_external_identities_id_fk" FOREIGN KEY ("external_author_id") REFERENCES "public"."external_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_external_assignee_id_external_identities_id_fk" FOREIGN KEY ("external_assignee_id") REFERENCES "public"."external_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_external_author_id_external_identities_id_fk" FOREIGN KEY ("external_author_id") REFERENCES "public"."external_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_worklogs" ADD CONSTRAINT "issue_worklogs_external_worker_id_external_identities_id_fk" FOREIGN KEY ("external_worker_id") REFERENCES "public"."external_identities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_external_uploader_id_external_identities_id_fk" FOREIGN KEY ("external_uploader_id") REFERENCES "public"."external_identities"("id") ON DELETE restrict ON UPDATE no action;