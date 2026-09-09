CREATE TABLE "export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"setting_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"actor_id" text NOT NULL,
	"config" jsonb NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_worklogs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"project_id" text NOT NULL,
	"local_id" text NOT NULL,
	"external_id" text,
	"remote_version" text,
	"pending_create" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_setting_id_export_settings_id_fk" FOREIGN KEY ("setting_id") REFERENCES "public"."export_settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_settings" ADD CONSTRAINT "export_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_settings" ADD CONSTRAINT "export_settings_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_worklogs" ADD CONSTRAINT "export_worklogs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_worklogs" ADD CONSTRAINT "export_worklogs_local_id_issue_worklogs_id_fk" FOREIGN KEY ("local_id") REFERENCES "public"."issue_worklogs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_queue" ON "export_jobs" USING btree ("setting_id","status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "export_settings_project_provider" ON "export_settings" USING btree ("project_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "export_worklogs_local" ON "export_worklogs" USING btree ("project_id","provider","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "export_worklogs_remote" ON "export_worklogs" USING btree ("project_id","provider","external_id");