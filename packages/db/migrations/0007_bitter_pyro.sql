CREATE TABLE "comment_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"project_file_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "comment_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"comment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"parent_id" text,
	"author_id" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "comments_parent_not_self" CHECK ("issue_comments"."parent_id" IS NULL OR "issue_comments"."parent_id" <> "issue_comments"."id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "comment_attachments_file_unique" ON "comment_attachments" USING btree ("comment_id","project_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comment_mentions_user_unique" ON "comment_mentions" USING btree ("comment_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_project_id_unique" ON "issue_comments" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_issue_id_unique" ON "issue_comments" USING btree ("issue_id","id");--> statement-breakpoint
CREATE INDEX "comments_siblings_idx" ON "issue_comments" USING btree ("issue_id","parent_id","created_at","id");--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_comment_fk" FOREIGN KEY ("project_id","comment_id") REFERENCES "public"."issue_comments"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_attachments" ADD CONSTRAINT "comment_attachments_file_fk" FOREIGN KEY ("project_id","project_file_id") REFERENCES "public"."project_files"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_comment_id_issue_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."issue_comments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "comments_issue_fk" FOREIGN KEY ("project_id","issue_id") REFERENCES "public"."issues"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "comments_parent_fk" FOREIGN KEY ("issue_id","parent_id") REFERENCES "public"."issue_comments"("issue_id","id") ON DELETE restrict ON UPDATE no action;
