CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"request_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent" jsonb NOT NULL,
	"requester_name" text NOT NULL,
	"command" text NOT NULL,
	"message" text NOT NULL,
	"repositories" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"instructions" text NOT NULL,
	"connection_id" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"error" text,
	"claim" text,
	"lease_until" timestamp with time zone,
	"container_retained" boolean DEFAULT false NOT NULL,
	"idle_until" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_runs_state_valid" CHECK ("agent_runs"."state" IN ('queued','preparing','working','needs_input','completed','failed','stopped'))
);
--> statement-breakpoint
CREATE TABLE "agent_run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run_inputs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"message" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_issue_fk" FOREIGN KEY ("project_id","issue_id") REFERENCES "public"."issues"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_events" ADD CONSTRAINT "agent_run_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_inputs" ADD CONSTRAINT "agent_run_inputs_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_inputs" ADD CONSTRAINT "agent_run_inputs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_request_unique" ON "agent_runs" USING btree ("requester_id","request_id");--> statement-breakpoint
CREATE INDEX "agent_runs_issue_idx" ON "agent_runs" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_queue_idx" ON "agent_runs" USING btree ("state","lease_until");--> statement-breakpoint
CREATE INDEX "agent_run_events_run_idx" ON "agent_run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_inputs_request_unique" ON "agent_run_inputs" USING btree ("user_id","request_id");--> statement-breakpoint
-- Capture closure durably even if an issue is reopened before a worker poll.
CREATE FUNCTION spectron_cancel_issue_runs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR EXISTS (SELECT 1 FROM issue_states WHERE id = NEW.state_id AND trigger IN ('finished', 'cancelled')) THEN
    UPDATE agent_runs SET stop_requested = true, error = 'Issue closed, cancelled, or deleted.', updated_at = now()
    WHERE issue_id = NEW.id AND (state IN ('queued','preparing','working','needs_input') OR container_retained);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agent_runs_issue_closure AFTER UPDATE OF state_id, deleted_at ON issues FOR EACH ROW EXECUTE FUNCTION spectron_cancel_issue_runs();
