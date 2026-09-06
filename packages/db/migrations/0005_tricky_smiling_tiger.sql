CREATE TYPE "public"."issue_trigger" AS ENUM('opened', 'in_progress', 'blocked', 'cancelled', 'finished');--> statement-breakpoint
CREATE TABLE "issues" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"author_id" text NOT NULL,
	"assignee_id" text,
	"state_id" text NOT NULL,
	"priority_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "issues_number_positive" CHECK ("issues"."number" > 0),
	CONSTRAINT "issues_parent_not_self" CHECK ("issues"."parent_id" IS NULL OR "issues"."parent_id" <> "issues"."id")
);
--> statement-breakpoint
CREATE TABLE "issue_history" (
	"id" text PRIMARY KEY NOT NULL,
	"issue_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_priorities" (
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
CREATE TABLE "issue_states" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"trigger" "issue_trigger" NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	CONSTRAINT "issue_states_default_opened" CHECK (NOT "issue_states"."is_default" OR ("issue_states"."trigger" = 'opened' AND "issue_states"."deleted_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "project_history" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "issue_counter" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "issues_project_number_unique" ON "issues" USING btree ("project_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_project_id_unique" ON "issues" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "issues_parent_idx" ON "issues" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "issue_history_issue_idx" ON "issue_history" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_priorities_project_id_unique" ON "issue_priorities" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_states_project_id_unique" ON "issue_states" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_states_default_unique" ON "issue_states" USING btree ("project_id") WHERE "issue_states"."is_default" AND "issue_states"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "project_history_project_idx" ON "project_history" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_parent_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."issues"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_state_fk" FOREIGN KEY ("project_id","state_id") REFERENCES "public"."issue_states"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_priority_fk" FOREIGN KEY ("project_id","priority_id") REFERENCES "public"."issue_priorities"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_history" ADD CONSTRAINT "issue_history_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_history" ADD CONSTRAINT "issue_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_priorities" ADD CONSTRAINT "issue_priorities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_states" ADD CONSTRAINT "issue_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_history" ADD CONSTRAINT "project_history_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_history" ADD CONSTRAINT "project_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Backfill existing projects with URL-safe 21-character random IDs.
INSERT INTO issue_states (id, project_id, name, trigger, position, is_default)
SELECT substr(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), 1, 21), p.id, s.name, s.trigger::issue_trigger, s.position, s.position = 0
FROM projects p CROSS JOIN (VALUES ('Todo', 'opened', 0), ('In progress', 'in_progress', 1), ('Blocked', 'blocked', 2), ('Cancelled', 'cancelled', 3), ('Done', 'finished', 4)) AS s(name, trigger, position);
--> statement-breakpoint
INSERT INTO issue_priorities (id, project_id, name, position)
SELECT substr(translate(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), 1, 21), p.id, s.name, s.position
FROM projects p CROSS JOIN (VALUES ('Urgent', 0), ('High', 1), ('Normal', 2), ('Low', 3)) AS s(name, position);
--> statement-breakpoint
CREATE FUNCTION prevent_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History is append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER issue_history_immutable BEFORE UPDATE OR DELETE ON issue_history FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
--> statement-breakpoint
CREATE TRIGGER project_history_immutable BEFORE UPDATE OR DELETE ON project_history FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
