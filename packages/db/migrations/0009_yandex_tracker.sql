CREATE TABLE "integration_entities" (
	"integration_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"local_id" text NOT NULL,
	"external_id" text NOT NULL,
	"external_key" text,
	"local_updated_at" timestamp with time zone NOT NULL,
	"remote_updated_at" text NOT NULL,
	CONSTRAINT "integration_entities_integration_id_entity_type_local_id_pk" PRIMARY KEY("integration_id","entity_type","local_id")
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
	CONSTRAINT "project_fields_type" CHECK ("project_fields"."type" in ('text', 'date', 'number', 'user'))
);
--> statement-breakpoint
CREATE TABLE "project_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"token" text NOT NULL,
	"organization_id" text NOT NULL,
	"organization_type" text NOT NULL,
	"queue" text NOT NULL,
	"mappings" jsonb DEFAULT '{"statuses":{},"priorities":{},"users":{},"fields":{}}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_integrations_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "issue_priorities" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "issue_states" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "integration_entities" ADD CONSTRAINT "integration_entities_integration_id_project_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."project_integrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_fields" ADD CONSTRAINT "project_fields_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_integrations" ADD CONSTRAINT "project_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_entities_external_unique" ON "integration_entities" USING btree ("integration_id","entity_type","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_fields_name_unique" ON "project_fields" USING btree ("project_id","name");