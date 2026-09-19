ALTER TABLE agent_workspaces ALTER COLUMN next_sync_at DROP NOT NULL;
ALTER TABLE agent_workspaces ADD COLUMN synced_version integer NOT NULL DEFAULT 0;
ALTER TABLE git_reply_drafts ADD COLUMN discarded_at timestamptz;
UPDATE agent_workspaces SET next_sync_at = NULL WHERE pull->>'state' IN ('closed', 'merged');
