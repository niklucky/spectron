CREATE TABLE "issue_read_receipts" (
	"issue_id" text NOT NULL,
	"user_id" text NOT NULL,
	"seen_through" timestamp with time zone NOT NULL,
	CONSTRAINT "issue_read_receipts_user_id_issue_id_pk" PRIMARY KEY("user_id","issue_id")
);
--> statement-breakpoint
ALTER TABLE "issue_read_receipts" ADD CONSTRAINT "issue_read_receipts_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_read_receipts" ADD CONSTRAINT "issue_read_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_mentions_active_user_idx" ON "comment_mentions" USING btree ("user_id") WHERE "comment_mentions"."deleted_at" IS NULL;