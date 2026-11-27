-- NOTIFY is delivered after commit and folds identical messages within a transaction.
-- Only routing keys leave the transaction. Content is read through the regular API.
CREATE FUNCTION notify_flow_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record := COALESCE(NEW, OLD);
  affected_issue text;
  affected_project text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'issues' THEN affected_issue := r.id; affected_project := r.project_id;
    WHEN 'agent_run_events', 'agent_run_inputs', 'agent_review_findings' THEN
      SELECT issue_id INTO affected_issue FROM agent_runs WHERE id = r.run_id;
    WHEN 'git_discussions', 'git_operations' THEN
      SELECT issue_id INTO affected_issue FROM agent_workspaces WHERE id = r.workspace_id;
    WHEN 'git_reply_drafts' THEN
      SELECT w.issue_id INTO affected_issue FROM git_discussions d
        JOIN agent_workspaces w ON w.id = d.workspace_id WHERE d.id = r.discussion_id;
    WHEN 'integration_records' THEN
      IF r.kind <> 'comment' THEN RETURN NULL; END IF;
      SELECT issue_id INTO affected_issue FROM issue_comments WHERE id = r.local_id;
    WHEN 'export_jobs' THEN
      IF r.action NOT IN ('comment.create', 'comment.update') THEN RETURN NULL; END IF;
      affected_issue := r.issue_id;
    ELSE affected_issue := r.issue_id;
  END CASE;
  IF affected_project IS NULL THEN
    SELECT project_id INTO affected_project FROM issues WHERE id = affected_issue;
  END IF;
  IF affected_project IS NOT NULL THEN
    PERFORM pg_notify('spectron_flow', json_build_object(
      'projectId', affected_project, 'issueId', affected_issue, 'kind', TG_ARGV[0]
    )::text);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  source record;
BEGIN
  FOR source IN SELECT * FROM (VALUES
    ('issues', 'issue'), ('issue_history', 'issue'), ('issue_comments', 'issue'),
    ('issue_attachments', 'issue'), ('issue_worklogs', 'issue'), ('issue_tags', 'issue'),
    ('export_jobs', 'activity'), ('integration_records', 'activity'),
    ('agent_runs', 'runs'), ('agent_run_events', 'runs'), ('agent_run_inputs', 'runs'),
    ('agent_review_findings', 'runs'), ('local_handoffs', 'handoffs'),
    ('agent_workspaces', 'git'), ('git_discussions', 'git'), ('git_operations', 'git'),
    ('git_reply_drafts', 'git')
  ) AS sources(tbl, kind) LOOP
    EXECUTE format('CREATE TRIGGER flow_change AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION notify_flow_change(%L)', source.tbl, source.kind);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- Retry-publication controls on run cards also depend on workspace ownership.
CREATE TRIGGER flow_run_workspace_change
AFTER INSERT OR UPDATE OF owner_run_id, last_run_id, pending OR DELETE ON agent_workspaces
FOR EACH ROW EXECUTE FUNCTION notify_flow_change('runs');
