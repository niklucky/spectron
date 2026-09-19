ALTER TABLE project_members ADD COLUMN can_merge boolean NOT NULL DEFAULT false;
ALTER TABLE git_connections ADD COLUMN webhook_secret text;
ALTER TABLE agent_runs ADD COLUMN handoff_from_id text REFERENCES agent_runs(id) ON DELETE RESTRICT;
ALTER TABLE agent_run_inputs ADD COLUMN feedback jsonb NOT NULL DEFAULT '[]';
ALTER TABLE agent_workspaces
 ADD COLUMN successor_run_id text REFERENCES agent_runs(id) ON DELETE RESTRICT,
 ADD COLUMN operation_id text,
 ADD COLUMN activity jsonb,
 ADD COLUMN sync_claim text,
 ADD COLUMN sync_lease_until timestamptz,
 ADD COLUMN synced_at timestamptz,
 ADD COLUMN next_sync_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN sync_error text,
 ADD COLUMN sync_version integer NOT NULL DEFAULT 0;
CREATE TABLE git_discussions (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES agent_workspaces(id) ON DELETE CASCADE,
 external_id text NOT NULL, data jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (workspace_id, external_id)
);
CREATE TABLE git_reply_drafts (
 id text PRIMARY KEY, discussion_id text NOT NULL REFERENCES git_discussions(id) ON DELETE CASCADE,
 author_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 run_id text REFERENCES agent_runs(id) ON DELETE RESTRICT,
 body text NOT NULL, revision integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','publishing','published','uncertain')),
 external_id text, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (run_id, discussion_id)
);
CREATE TABLE git_operations (
 attempt_id text NOT NULL,
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES agent_workspaces(id) ON DELETE RESTRICT,
 requester_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT, request_id text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('reply','resolve','reopen','ready','merge','close')),
 state text NOT NULL DEFAULT 'dispatching' CHECK (state IN ('dispatching','completed','uncertain','failed')),
 payload jsonb NOT NULL, error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requester_id, request_id)
);
CREATE TABLE git_webhook_deliveries (
 connection_id text NOT NULL REFERENCES git_connections(id) ON DELETE CASCADE, delivery_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(connection_id,delivery_id)
);
CREATE INDEX agent_workspaces_sync_due ON agent_workspaces(next_sync_at);
