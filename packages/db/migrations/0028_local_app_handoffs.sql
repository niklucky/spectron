CREATE TABLE "local_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"owner_name" text NOT NULL,
	"request_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"application" text NOT NULL,
	"message" text NOT NULL,
	"summary" text NOT NULL,
	"origin_url" text,
	"repository_id" text,
	"attachments" jsonb NOT NULL,
	"file_token" text,
	"files_expire_at" timestamp with time zone NOT NULL,
	"launch_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_handoffs_application" CHECK ("local_handoffs"."application" IN ('codex', 't3code'))
);--> statement-breakpoint
ALTER TABLE "ai_agents" DROP CONSTRAINT "ai_agents_active_connection";--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "local_app" text;--> statement-breakpoint
ALTER TABLE "local_handoffs" ADD CONSTRAINT "local_handoffs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_handoffs" ADD CONSTRAINT "local_handoffs_issue_fk" FOREIGN KEY ("project_id","issue_id") REFERENCES "public"."issues"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "local_handoffs_request_unique" ON "local_handoffs" USING btree ("owner_id","request_id");--> statement-breakpoint
CREATE INDEX "local_handoffs_issue_idx" ON "local_handoffs" USING btree ("issue_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_local_app" CHECK ("ai_agents"."local_app" IS NULL OR "ai_agents"."local_app" IN ('codex', 't3code'));--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_active_connection" CHECK ("ai_agents"."deleted_at" IS NOT NULL OR ("ai_agents"."local_app" IS NULL AND "ai_agents"."connection_id" IS NOT NULL) OR ("ai_agents"."local_app" IS NOT NULL AND "ai_agents"."local_app" IN ('codex', 't3code') AND "ai_agents"."connection_id" IS NULL));
