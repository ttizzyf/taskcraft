-- Taskcraft storage contract. This is a design artifact, not a production migration.
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Task content and reducer inputs. Public status is projected from the current snapshot.
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
  objective_md TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  acceptance_json TEXT NOT NULL DEFAULT '[]',
  non_goals_json TEXT NOT NULL DEFAULT '[]',
  classification_facts_json TEXT NOT NULL DEFAULT '{}',
  classification_reasons_json TEXT NOT NULL DEFAULT '[]',
  parent_task_id TEXT REFERENCES tasks(id),
  activated_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  current_lifecycle_revision INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((cancelled_at IS NULL) = (cancel_reason IS NULL)),
  FOREIGN KEY (id, current_lifecycle_revision)
    REFERENCES lifecycle_revisions(task_id, revision)
    DEFERRABLE INITIALLY DEFERRED
);

-- A revision is an immutable lifecycle definition snapshot. Revision numbers form one line.
CREATE TABLE lifecycle_revisions (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'initial', 'replan_required', 'scope_changed', 'contract_changed',
    'level_changed', 'manual_revision'
  )),
  reason TEXT NOT NULL,
  compiler_version TEXT NOT NULL,
  facts_digest TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  change_summary_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, revision)
);

-- Definition tables contain graph shape and contracts only. Runtime facts live in attempts/results.
CREATE TABLE lifecycle_nodes (
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'frame', 'plan', 'execute', 'review', 'integrate', 'record'
  )),
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  procedure_ref TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  entry_gate_json TEXT NOT NULL DEFAULT '{}',
  exit_gate_json TEXT NOT NULL DEFAULT '{}',
  retry_policy_json TEXT NOT NULL DEFAULT '{}',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (task_id, lifecycle_revision, id),
  FOREIGN KEY (task_id, lifecycle_revision)
    REFERENCES lifecycle_revisions(task_id, revision)
);

CREATE TABLE lifecycle_edges (
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  from_node_id TEXT NOT NULL,
  to_node_id TEXT NOT NULL,
  condition_json TEXT NOT NULL DEFAULT '{"kind":"always"}',
  label TEXT,
  PRIMARY KEY (task_id, lifecycle_revision, from_node_id, to_node_id),
  CHECK (from_node_id <> to_node_id),
  FOREIGN KEY (task_id, lifecycle_revision, from_node_id)
    REFERENCES lifecycle_nodes(task_id, lifecycle_revision, id),
  FOREIGN KEY (task_id, lifecycle_revision, to_node_id)
    REFERENCES lifecycle_nodes(task_id, lifecycle_revision, id)
);

CREATE TABLE obligation_definitions (
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  id TEXT NOT NULL,
  duty TEXT NOT NULL CHECK (duty IN ('required', 'recommended', 'optional')),
  title TEXT NOT NULL,
  evaluator_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (task_id, lifecycle_revision, node_id, id),
  FOREIGN KEY (task_id, lifecycle_revision, node_id)
    REFERENCES lifecycle_nodes(task_id, lifecycle_revision, id)
);

-- Attempts are execution facts. A failed or stale host observation becomes an attempt outcome
-- only through a reducer command.
CREATE TABLE node_attempts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  actor_instance_id TEXT NOT NULL,
  host TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'created', 'running', 'finished', 'failed', 'cancelled', 'superseded'
  )),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN (
    'success', 'passed', 'changes_requested', 'replan_required', 'blocked',
    'failed', 'abandoned', 'unsupported', 'superseded'
  )),
  result_json TEXT,
  started_at TEXT,
  finished_at TEXT,
  UNIQUE (task_id, lifecycle_revision, node_id, attempt_number),
  UNIQUE (id, task_id),
  UNIQUE (id, task_id, lifecycle_revision, node_id),
  FOREIGN KEY (task_id, lifecycle_revision, node_id)
    REFERENCES lifecycle_nodes(task_id, lifecycle_revision, id)
);

-- A review link names the exact reviewed attempt, its purpose and the available run correlation.
CREATE TABLE review_links (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  review_attempt_id TEXT PRIMARY KEY,
  reviewed_attempt_id TEXT NOT NULL,
  review_purpose TEXT NOT NULL CHECK (review_purpose IN (
    'feasibility', 'delivery', 'integration'
  )),
  capability TEXT NOT NULL CHECK (capability IN (
    'context-only', 'manual-attach', 'host-observed'
  )),
  independence_status TEXT NOT NULL CHECK (independence_status IN (
    'observed-distinct', 'unverified', 'same-actor', 'unsupported'
  )),
  reviewer_principal_id TEXT,
  observed_host_session_id TEXT,
  created_at TEXT NOT NULL,
  CHECK (review_attempt_id <> reviewed_attempt_id),
  CHECK (
    independence_status <> 'observed-distinct'
    OR (
      capability = 'host-observed'
      AND observed_host_session_id IS NOT NULL
    )
  ),
  UNIQUE (review_attempt_id, task_id),
  FOREIGN KEY (review_attempt_id, task_id)
    REFERENCES node_attempts(id, task_id),
  FOREIGN KEY (reviewed_attempt_id, task_id)
    REFERENCES node_attempts(id, task_id)
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  node_attempt_id TEXT,
  type TEXT NOT NULL,
  reference TEXT NOT NULL,
  summary TEXT NOT NULL,
  digest TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (id, task_id),
  FOREIGN KEY (node_attempt_id, task_id)
    REFERENCES node_attempts(id, task_id)
);

-- Reviewers and other node actors append discovered task facts instead of rewriting task content.
CREATE TABLE task_facts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  category TEXT NOT NULL CHECK (category IN (
    'intent', 'probe', 'constraint', 'assumption', 'dependency', 'environment'
  )),
  subject TEXT NOT NULL,
  value_json TEXT NOT NULL,
  source_attempt_id TEXT NOT NULL,
  evidence_id TEXT,
  supersedes_fact_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (id, task_id),
  FOREIGN KEY (source_attempt_id, task_id)
    REFERENCES node_attempts(id, task_id),
  FOREIGN KEY (evidence_id, task_id)
    REFERENCES evidence(id, task_id),
  FOREIGN KEY (supersedes_fact_id, task_id)
    REFERENCES task_facts(id, task_id)
);

CREATE TABLE obligation_results (
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  obligation_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('satisfied', 'skipped')),
  satisfied_by_evidence_id TEXT,
  skip_reason TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, lifecycle_revision, node_id, obligation_id),
  CHECK (status <> 'satisfied' OR satisfied_by_evidence_id IS NOT NULL),
  FOREIGN KEY (task_id, lifecycle_revision, node_id, obligation_id)
    REFERENCES obligation_definitions(task_id, lifecycle_revision, node_id, id),
  FOREIGN KEY (satisfied_by_evidence_id, task_id)
    REFERENCES evidence(id, task_id)
);

CREATE TABLE review_findings (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  review_attempt_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('blocking', 'advisory')),
  disposition TEXT NOT NULL CHECK (disposition IN ('open', 'resolved', 'accepted')),
  summary TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  resolved_by_attempt_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (review_attempt_id, task_id)
    REFERENCES review_links(review_attempt_id, task_id),
  FOREIGN KEY (resolved_by_attempt_id, task_id)
    REFERENCES node_attempts(id, task_id)
);

CREATE TABLE blockers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  lifecycle_revision INTEGER,
  node_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN (
    'dependency', 'needs_input', 'needs_decision', 'evidence', 'host', 'conflict'
  )),
  waiting_reason TEXT NOT NULL CHECK (waiting_reason IN (
    'blocked_dependency', 'needs_input', 'needs_decision', 'failed_retries_exhausted'
  )),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  reason TEXT NOT NULL,
  remediation_command TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (node_id IS NULL OR lifecycle_revision IS NOT NULL),
  FOREIGN KEY (task_id, lifecycle_revision, node_id)
    REFERENCES lifecycle_nodes(task_id, lifecycle_revision, id)
);

-- Agent runs are observations. observation_status never acts as a task or attempt status source.
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  node_attempt_id TEXT NOT NULL,
  host TEXT NOT NULL,
  host_run_id TEXT,
  host_session_id TEXT,
  observation_status TEXT NOT NULL CHECK (observation_status IN (
    'pending', 'running', 'stale', 'finished', 'failed', 'unsupported'
  )),
  last_seen_at TEXT,
  finish_reason TEXT,
  observation_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (node_attempt_id, task_id)
    REFERENCES node_attempts(id, task_id)
);

CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  task_seq INTEGER NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  node_id TEXT,
  attempt_id TEXT,
  actor_instance_id TEXT NOT NULL,
  host TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  post_task_revision INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE (task_id, task_seq),
  CHECK (attempt_id IS NULL OR node_id IS NOT NULL),
  FOREIGN KEY (task_id, lifecycle_revision)
    REFERENCES lifecycle_revisions(task_id, revision),
  FOREIGN KEY (task_id, lifecycle_revision, node_id)
    REFERENCES lifecycle_nodes(task_id, lifecycle_revision, id),
  FOREIGN KEY (attempt_id, task_id, lifecycle_revision, node_id)
    REFERENCES node_attempts(id, task_id, lifecycle_revision, node_id)
);

-- Lifecycle definitions are append-only. Runtime facts and projections remain writable through
-- reducer commands in their own tables.
CREATE TRIGGER lifecycle_revisions_immutable_update
BEFORE UPDATE ON lifecycle_revisions
BEGIN
  SELECT RAISE(ABORT, 'lifecycle revisions are append-only');
END;

CREATE TRIGGER lifecycle_revisions_immutable_delete
BEFORE DELETE ON lifecycle_revisions
BEGIN
  SELECT RAISE(ABORT, 'lifecycle revisions are append-only');
END;

CREATE TRIGGER lifecycle_nodes_immutable_update
BEFORE UPDATE ON lifecycle_nodes
BEGIN
  SELECT RAISE(ABORT, 'lifecycle definitions are immutable');
END;

CREATE TRIGGER lifecycle_nodes_immutable_delete
BEFORE DELETE ON lifecycle_nodes
BEGIN
  SELECT RAISE(ABORT, 'lifecycle definitions are immutable');
END;

CREATE TRIGGER lifecycle_edges_immutable_update
BEFORE UPDATE ON lifecycle_edges
BEGIN
  SELECT RAISE(ABORT, 'lifecycle definitions are immutable');
END;

CREATE TRIGGER lifecycle_edges_immutable_delete
BEFORE DELETE ON lifecycle_edges
BEGIN
  SELECT RAISE(ABORT, 'lifecycle definitions are immutable');
END;

CREATE TRIGGER obligation_definitions_immutable_update
BEFORE UPDATE ON obligation_definitions
BEGIN
  SELECT RAISE(ABORT, 'obligation definitions are immutable');
END;

CREATE TRIGGER obligation_definitions_immutable_delete
BEFORE DELETE ON obligation_definitions
BEGIN
  SELECT RAISE(ABORT, 'obligation definitions are immutable');
END;

CREATE TRIGGER review_links_node_kinds_insert
BEFORE INSERT ON review_links
WHEN NOT EXISTS (
  SELECT 1
  FROM node_attempts AS attempt
  JOIN lifecycle_nodes AS node
    ON node.task_id = attempt.task_id
   AND node.lifecycle_revision = attempt.lifecycle_revision
   AND node.id = attempt.node_id
  WHERE attempt.id = NEW.review_attempt_id
    AND attempt.task_id = NEW.task_id
    AND node.kind = 'review'
) OR NOT EXISTS (
  SELECT 1
  FROM node_attempts AS attempt
  JOIN lifecycle_nodes AS node
    ON node.task_id = attempt.task_id
   AND node.lifecycle_revision = attempt.lifecycle_revision
   AND node.id = attempt.node_id
  WHERE attempt.id = NEW.reviewed_attempt_id
    AND attempt.task_id = NEW.task_id
    AND attempt.lifecycle_revision = (
      SELECT lifecycle_revision
      FROM node_attempts
      WHERE id = NEW.review_attempt_id
        AND task_id = NEW.task_id
    )
    AND (
      (NEW.review_purpose = 'feasibility' AND node.kind = 'plan')
      OR (NEW.review_purpose = 'delivery' AND node.kind = 'execute')
      OR (NEW.review_purpose = 'integration' AND node.kind = 'integrate')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'review purpose must match the reviewed attempt kind');
END;

CREATE TRIGGER review_links_node_kinds_update
BEFORE UPDATE OF task_id, review_attempt_id, reviewed_attempt_id, review_purpose ON review_links
WHEN NOT EXISTS (
  SELECT 1
  FROM node_attempts AS attempt
  JOIN lifecycle_nodes AS node
    ON node.task_id = attempt.task_id
   AND node.lifecycle_revision = attempt.lifecycle_revision
   AND node.id = attempt.node_id
  WHERE attempt.id = NEW.review_attempt_id
    AND attempt.task_id = NEW.task_id
    AND node.kind = 'review'
) OR NOT EXISTS (
  SELECT 1
  FROM node_attempts AS attempt
  JOIN lifecycle_nodes AS node
    ON node.task_id = attempt.task_id
   AND node.lifecycle_revision = attempt.lifecycle_revision
   AND node.id = attempt.node_id
  WHERE attempt.id = NEW.reviewed_attempt_id
    AND attempt.task_id = NEW.task_id
    AND attempt.lifecycle_revision = (
      SELECT lifecycle_revision
      FROM node_attempts
      WHERE id = NEW.review_attempt_id
        AND task_id = NEW.task_id
    )
    AND (
      (NEW.review_purpose = 'feasibility' AND node.kind = 'plan')
      OR (NEW.review_purpose = 'delivery' AND node.kind = 'execute')
      OR (NEW.review_purpose = 'integration' AND node.kind = 'integrate')
    )
)
BEGIN
  SELECT RAISE(ABORT, 'review purpose must match the reviewed attempt kind');
END;

CREATE TRIGGER task_facts_immutable_update
BEFORE UPDATE ON task_facts
BEGIN
  SELECT RAISE(ABORT, 'task facts are append-only');
END;

CREATE TRIGGER task_facts_immutable_delete
BEFORE DELETE ON task_facts
BEGIN
  SELECT RAISE(ABORT, 'task facts are append-only');
END;

CREATE TRIGGER obligation_results_required_skip_insert
BEFORE INSERT ON obligation_results
WHEN NEW.status = 'skipped'
  AND EXISTS (
    SELECT 1
    FROM obligation_definitions
    WHERE task_id = NEW.task_id
      AND lifecycle_revision = NEW.lifecycle_revision
      AND node_id = NEW.node_id
      AND id = NEW.obligation_id
      AND duty = 'required'
  )
BEGIN
  SELECT RAISE(ABORT, 'required obligations use a new lifecycle revision');
END;

CREATE TRIGGER obligation_results_required_skip_update
BEFORE UPDATE OF status ON obligation_results
WHEN NEW.status = 'skipped'
  AND EXISTS (
    SELECT 1
    FROM obligation_definitions
    WHERE task_id = NEW.task_id
      AND lifecycle_revision = NEW.lifecycle_revision
      AND node_id = NEW.node_id
      AND id = NEW.obligation_id
      AND duty = 'required'
  )
BEGIN
  SELECT RAISE(ABORT, 'required obligations use a new lifecycle revision');
END;

CREATE TRIGGER obligation_results_evidence_owner_insert
BEFORE INSERT ON obligation_results
WHEN NEW.status = 'satisfied'
  AND NOT EXISTS (
    SELECT 1
    FROM evidence AS evidence_row
    JOIN node_attempts AS attempt
      ON attempt.id = evidence_row.node_attempt_id
     AND attempt.task_id = evidence_row.task_id
    WHERE evidence_row.id = NEW.satisfied_by_evidence_id
      AND evidence_row.task_id = NEW.task_id
      AND attempt.lifecycle_revision = NEW.lifecycle_revision
      AND attempt.node_id = NEW.node_id
  )
BEGIN
  SELECT RAISE(ABORT, 'obligation evidence must belong to the target node attempt');
END;

CREATE TRIGGER obligation_results_evidence_owner_update
BEFORE UPDATE OF status, satisfied_by_evidence_id ON obligation_results
WHEN NEW.status = 'satisfied'
  AND NOT EXISTS (
    SELECT 1
    FROM evidence AS evidence_row
    JOIN node_attempts AS attempt
      ON attempt.id = evidence_row.node_attempt_id
     AND attempt.task_id = evidence_row.task_id
    WHERE evidence_row.id = NEW.satisfied_by_evidence_id
      AND evidence_row.task_id = NEW.task_id
      AND attempt.lifecycle_revision = NEW.lifecycle_revision
      AND attempt.node_id = NEW.node_id
  )
BEGIN
  SELECT RAISE(ABORT, 'obligation evidence must belong to the target node attempt');
END;

CREATE TRIGGER events_task_sequence_insert
BEFORE INSERT ON events
WHEN NEW.task_seq <> COALESCE(
  (SELECT MAX(task_seq) + 1 FROM events WHERE task_id = NEW.task_id),
  1
)
BEGIN
  SELECT RAISE(ABORT, 'task event sequence must be contiguous');
END;

CREATE TRIGGER events_immutable_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER events_immutable_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE INDEX idx_tasks_updated ON tasks(updated_at DESC);
CREATE INDEX idx_tasks_lifecycle ON tasks(current_lifecycle_revision, updated_at DESC);
CREATE INDEX idx_nodes_revision ON lifecycle_nodes(task_id, lifecycle_revision);
CREATE INDEX idx_attempts_status ON node_attempts(task_id, lifecycle_revision, status);
CREATE INDEX idx_attempts_outcome ON node_attempts(task_id, outcome);
CREATE INDEX idx_blockers_open ON blockers(task_id, status, waiting_reason);
CREATE INDEX idx_events_task_seq ON events(task_id, task_seq);
CREATE INDEX idx_agent_runs_observation ON agent_runs(observation_status, last_seen_at);
