CREATE TABLE "issue_worklogs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"worker_user_id" text NOT NULL,
	"recorded_by" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "worklogs_duration_positive" CHECK ("issue_worklogs"."duration_seconds" > 0)
);
--> statement-breakpoint
ALTER TABLE "issue_worklogs" ADD CONSTRAINT "issue_worklogs_worker_user_id_users_id_fk" FOREIGN KEY ("worker_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_worklogs" ADD CONSTRAINT "issue_worklogs_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_worklogs" ADD CONSTRAINT "worklogs_issue_fk" FOREIGN KEY ("project_id","issue_id") REFERENCES "public"."issues"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worklogs_issue_created_idx" ON "issue_worklogs" USING btree ("issue_id","created_at","id");