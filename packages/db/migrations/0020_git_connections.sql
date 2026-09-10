CREATE TABLE "git_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_token" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"actor" jsonb,
	"commit_author_name" text DEFAULT '' NOT NULL,
	"commit_author_email" text DEFAULT '' NOT NULL,
	"check_status" text DEFAULT 'untested' NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "git_connections_provider" CHECK ("git_connections"."provider" IN ('github', 'gitlab'))
);
--> statement-breakpoint
CREATE TABLE "git_repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"external_id" text NOT NULL,
	"full_name" text NOT NULL,
	"web_url" text NOT NULL,
	"clone_url" text NOT NULL,
	"default_branch" text,
	"target_branch" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "git_connections_project_id_unique" ON "git_connections" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "git_connections" ADD CONSTRAINT "git_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_connections" ADD CONSTRAINT "git_connections_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repositories" ADD CONSTRAINT "git_repositories_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_repositories" ADD CONSTRAINT "git_repositories_connection_project_fk" FOREIGN KEY ("project_id","connection_id") REFERENCES "public"."git_connections"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "git_repositories_remote_unique" ON "git_repositories" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "git_repositories_default_unique" ON "git_repositories" USING btree ("project_id") WHERE "git_repositories"."is_default" = true;