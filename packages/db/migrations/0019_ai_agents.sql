CREATE TYPE "public"."ai_effort" AS ENUM('none', 'low', 'medium', 'high', 'xhigh', 'max');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('openai', 'zai', 'deepseek', 'anthropic');--> statement-breakpoint
CREATE TABLE "ai_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"connection_id" text,
	"name" text NOT NULL,
	"avatar" text,
	"model" text NOT NULL,
	"effort" "ai_effort",
	"role" text NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ai_agents_active_connection" CHECK ("ai_agents"."deleted_at" IS NOT NULL OR "ai_agents"."connection_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ai_agent_shares" (
	"agent_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"project_id" text NOT NULL,
	"visibility" text NOT NULL,
	CONSTRAINT "ai_agent_shares_agent_id_project_id_pk" PRIMARY KEY("agent_id","project_id"),
	CONSTRAINT "ai_agent_shares_visibility" CHECK ("ai_agent_shares"."visibility" IN ('selected', 'project'))
);
--> statement-breakpoint
CREATE TABLE "ai_agent_share_members" (
	"agent_id" text NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "ai_agent_share_members_agent_id_project_id_user_id_pk" PRIMARY KEY("agent_id","project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ai_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"encrypted_key" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"key_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"check_status" text DEFAULT 'untested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agents_owner_id_unique" ON "ai_agents" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "ai_agents_connection_idx" ON "ai_agents" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_connections_owner_id_unique" ON "ai_connections" USING btree ("owner_id","id");--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_connection_owner_fk" FOREIGN KEY ("owner_id","connection_id") REFERENCES "public"."ai_connections"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_shares" ADD CONSTRAINT "ai_agent_shares_agent_fk" FOREIGN KEY ("owner_id","agent_id") REFERENCES "public"."ai_agents"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_shares" ADD CONSTRAINT "ai_agent_shares_owner_membership_fk" FOREIGN KEY ("project_id","owner_id") REFERENCES "public"."project_members"("project_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_share_members" ADD CONSTRAINT "ai_agent_share_members_share_fk" FOREIGN KEY ("agent_id","project_id") REFERENCES "public"."ai_agent_shares"("agent_id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_share_members" ADD CONSTRAINT "ai_agent_share_members_membership_fk" FOREIGN KEY ("project_id","user_id") REFERENCES "public"."project_members"("project_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_connections" ADD CONSTRAINT "ai_connections_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
