ALTER TABLE agent_runs ADD COLUMN review jsonb;
CREATE TABLE agent_review_findings (
 id text PRIMARY KEY, run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
 ordinal integer NOT NULL, path text NOT NULL, line integer NOT NULL CHECK (line > 0), side text NOT NULL CHECK (side IN ('LEFT','RIGHT')),
 explanation text NOT NULL, suggested_fix text NOT NULL DEFAULT '', revision integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','dismissed','publishing','published','stale','uncertain')),
 error text, external_id text, external_url text, published_by text REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_review_findings_run_ordinal ON agent_review_findings(run_id, ordinal);
