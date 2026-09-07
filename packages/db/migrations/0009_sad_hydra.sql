CREATE TABLE "integration_records" (
	"id" text PRIMARY KEY NOT NULL,
	"integration_id" text NOT NULL,
	"kind" text NOT NULL,
	"local_id" text NOT NULL,
	"external_id" text,
	"local_hash" text,
	"remote_hash" text,
	"pending_create" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jira_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"base_url" text NOT NULL,
	"project_key" text NOT NULL,
	"email" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"issue_type_id" text NOT NULL,
	"mappings" jsonb DEFAULT '{"statuses":{},"priorities":{},"fields":{},"users":{}}'::jsonb NOT NULL,
	"lease" text,
	"lease_until" timestamp with time zone,
	"last_imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jira_integrations_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
CREATE TABLE "project_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"external_id" text,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "project_fields_type" CHECK ("project_fields"."type" in ('text','date','number','user'))
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "field_values" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_attachments" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "issue_priorities" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "issue_states" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "issue_worklogs" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "integration_records" ADD CONSTRAINT "integration_records_integration_id_jira_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."jira_integrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_integrations" ADD CONSTRAINT "jira_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_fields" ADD CONSTRAINT "project_fields_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_records_local_unique" ON "integration_records" USING btree ("integration_id","kind","local_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_records_external_unique" ON "integration_records" USING btree ("integration_id","kind","external_id");