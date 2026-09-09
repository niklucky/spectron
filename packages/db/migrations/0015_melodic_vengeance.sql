CREATE TABLE "issue_tags" (
	"project_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"tag_id" text NOT NULL,
	CONSTRAINT "issue_tags_issue_id_tag_id_pk" PRIMARY KEY("issue_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "issue_types" (
	"external_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"external_id" text,
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "issue_type_id" text;--> statement-breakpoint
ALTER TABLE "issue_tags" ADD CONSTRAINT "issue_tags_issue_fk" FOREIGN KEY ("project_id","issue_id") REFERENCES "public"."issues"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_types" ADD CONSTRAINT "issue_types_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_types_project_id_unique" ON "issue_types" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_project_id_unique" ON "tags" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_project_name_unique" ON "tags" USING btree ("project_id","name") WHERE "tags"."deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_type_fk" FOREIGN KEY ("project_id","issue_type_id") REFERENCES "public"."issue_types"("project_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "issue_tags" ADD CONSTRAINT "issue_tags_tag_fk" FOREIGN KEY ("project_id","tag_id") REFERENCES "public"."tags"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
INSERT INTO issue_types (id, project_id, name, position) SELECT gen_random_uuid()::text, p.id, v.name, v.position FROM projects p CROSS JOIN (VALUES ('Story',0), ('Epic',1), ('Bug',2), ('Task',3)) AS v(name,position);
