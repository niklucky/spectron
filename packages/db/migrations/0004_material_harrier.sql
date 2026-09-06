-- Preserve existing IDs and links while allowing NanoIDs for new records.
ALTER TABLE "project_members" DROP CONSTRAINT "project_members_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_invitations" DROP CONSTRAINT "project_invitations_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "project_invitations" ALTER COLUMN "id" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "id" TYPE text USING "id"::text;
--> statement-breakpoint
ALTER TABLE "project_invitations" ALTER COLUMN "id" TYPE text USING "id"::text;
--> statement-breakpoint
ALTER TABLE "project_invitations" ALTER COLUMN "project_id" TYPE text USING "project_id"::text;
--> statement-breakpoint
ALTER TABLE "project_members" ALTER COLUMN "project_id" TYPE text USING "project_id"::text;
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
