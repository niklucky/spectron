-- Retained containers need cleanup on issue closure; completed results are not failures.
CREATE OR REPLACE FUNCTION spectron_cancel_issue_runs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR EXISTS (SELECT 1 FROM issue_states WHERE id = NEW.state_id AND trigger IN ('finished', 'cancelled')) THEN
    UPDATE agent_runs SET stop_requested = true,
      error = CASE WHEN state IN ('queued','preparing','working','needs_input') THEN 'Issue closed, cancelled, or deleted.' ELSE error END,
      updated_at = now()
    WHERE issue_id = NEW.id AND (state IN ('queued','preparing','working','needs_input') OR container_retained);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Repair only the erroneous closure alert written by the previous trigger.
UPDATE agent_runs SET error = NULL WHERE state = 'completed' AND error = 'Issue closed, cancelled, or deleted.';
