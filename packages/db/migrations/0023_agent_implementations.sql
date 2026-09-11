CREATE TABLE "agent_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"last_run_id" text,
	"contributions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"branch" text NOT NULL,
	"target_branch" text NOT NULL,
	"owner_run_id" text,
	"base_commit" text,
	"head_commit" text,
	"remote_commit" text,
	"pull" jsonb,
	"pending" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "implementation" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_repository_id_git_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."git_repositories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_owner_run_id_agent_runs_id_fk" FOREIGN KEY ("owner_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_issue_fk" FOREIGN KEY ("project_id","issue_id") REFERENCES "public"."issues"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_workspaces_issue_repo_unique" ON "agent_workspaces" USING btree ("issue_id","repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_workspaces_branch_unique" ON "agent_workspaces" USING btree ("repository_id","branch");