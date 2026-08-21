-- Revision/node-scoped Spec adoption facts. Registry files remain Git-owned;
-- SQLite stores only the exact snapshot adopted by a lifecycle definition.

CREATE TABLE lifecycle_spec_bindings (
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  spec_id TEXT NOT NULL CHECK (length(trim(spec_id)) > 0),
  spec_kind TEXT NOT NULL CHECK (spec_kind IN ('engineering', 'domain')),
  spec_path TEXT NOT NULL CHECK (length(trim(spec_path)) > 0),
  spec_digest TEXT NOT NULL CHECK (
    length(spec_digest) = 64
    AND spec_digest NOT GLOB '*[^0-9a-f]*'
  ),
  duty TEXT NOT NULL CHECK (duty IN ('required', 'recommended')),
  source_kind TEXT NOT NULL CHECK (source_kind IN (
    'task_create', 'frame', 'accepted_plan', 'inherited_plan', 'refresh'
  )),
  source_task_id TEXT,
  source_attempt_id TEXT,
  created_by TEXT NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, lifecycle_revision, node_id, spec_id),
  CHECK (
    (source_kind = 'task_create' AND lifecycle_revision = 1
      AND source_task_id IS NULL AND source_attempt_id IS NULL)
    OR (source_kind = 'refresh' AND lifecycle_revision > 1
      AND source_task_id IS NULL AND source_attempt_id IS NULL)
    OR (source_kind IN ('frame', 'accepted_plan')
      AND source_task_id = task_id AND source_attempt_id IS NOT NULL)
    OR (source_kind = 'inherited_plan'
      AND source_task_id IS NOT NULL AND source_task_id <> task_id
      AND source_attempt_id IS NOT NULL)
  ),
  FOREIGN KEY (task_id, lifecycle_revision, node_id)
    REFERENCES lifecycle_nodes(task_id, lifecycle_revision, id),
  FOREIGN KEY (source_task_id) REFERENCES tasks(id),
  FOREIGN KEY (source_attempt_id, source_task_id)
    REFERENCES node_attempts(id, task_id)
);

-- Typed details are schema-validated by the command/reducer boundary. The
-- table keeps one immutable outcome for each successful Record attempt.
CREATE TABLE spec_impact_results (
  record_attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  record_node_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('none', 'updated', 'candidate')),
  details_json TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at TEXT NOT NULL,
  CHECK (length(trim(record_node_id)) > 0),
  UNIQUE (record_attempt_id, task_id),
  FOREIGN KEY (record_attempt_id, task_id, lifecycle_revision, record_node_id)
    REFERENCES node_attempts(id, task_id, lifecycle_revision, node_id)
);

CREATE INDEX lifecycle_spec_bindings_spec_idx
  ON lifecycle_spec_bindings(spec_id, task_id, lifecycle_revision);
CREATE INDEX lifecycle_spec_bindings_source_idx
  ON lifecycle_spec_bindings(source_attempt_id);
CREATE INDEX spec_impact_results_task_idx
  ON spec_impact_results(task_id, lifecycle_revision);

CREATE TRIGGER lifecycle_spec_bindings_source_insert
BEFORE INSERT ON lifecycle_spec_bindings
WHEN NEW.source_attempt_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM node_attempts AS attempt
  JOIN lifecycle_nodes AS node
    ON node.task_id = attempt.task_id
   AND node.lifecycle_revision = attempt.lifecycle_revision
   AND node.id = attempt.node_id
  WHERE attempt.id = NEW.source_attempt_id
    AND attempt.task_id = NEW.source_task_id
    AND (
      (NEW.source_kind = 'frame'
        AND attempt.task_id = NEW.task_id
        AND attempt.lifecycle_revision = NEW.lifecycle_revision
        AND node.kind = 'frame')
      OR (NEW.source_kind = 'accepted_plan'
        AND node.kind = 'plan'
        AND EXISTS (
          SELECT 1 FROM lifecycle_execution_sources AS source
          WHERE source.task_id = NEW.task_id
            AND source.lifecycle_revision = NEW.lifecycle_revision
            AND source.source_plan_attempt_id = NEW.source_attempt_id
        ))
      OR (NEW.source_kind = 'inherited_plan'
        AND node.kind = 'plan'
        AND EXISTS (
          SELECT 1 FROM lifecycle_inherited_planning AS inherited
          WHERE inherited.child_task_id = NEW.task_id
            AND inherited.child_lifecycle_revision = NEW.lifecycle_revision
            AND inherited.parent_task_id = NEW.source_task_id
            AND inherited.source_plan_attempt_id = NEW.source_attempt_id
        ))
    )
)
BEGIN
  SELECT RAISE(ABORT, 'Spec binding source must reference its Frame or Plan attempt');
END;

CREATE TRIGGER spec_impact_results_record_insert
BEFORE INSERT ON spec_impact_results
WHEN NOT EXISTS (
  SELECT 1
  FROM node_attempts AS attempt
  JOIN lifecycle_nodes AS node
    ON node.task_id = attempt.task_id
   AND node.lifecycle_revision = attempt.lifecycle_revision
   AND node.id = attempt.node_id
  WHERE attempt.id = NEW.record_attempt_id
    AND attempt.task_id = NEW.task_id
    AND attempt.lifecycle_revision = NEW.lifecycle_revision
    AND attempt.node_id = NEW.record_node_id
    AND attempt.status = 'finished'
    AND attempt.outcome = 'success'
    AND node.kind = 'record'
)
BEGIN
  SELECT RAISE(ABORT, 'Spec Impact must reference a successful Record attempt');
END;

CREATE TRIGGER lifecycle_spec_bindings_immutable_update
BEFORE UPDATE ON lifecycle_spec_bindings BEGIN
  SELECT RAISE(ABORT, 'Spec bindings are append-only');
END;
CREATE TRIGGER lifecycle_spec_bindings_immutable_delete
BEFORE DELETE ON lifecycle_spec_bindings BEGIN
  SELECT RAISE(ABORT, 'Spec bindings are append-only');
END;
CREATE TRIGGER spec_impact_results_immutable_update
BEFORE UPDATE ON spec_impact_results BEGIN
  SELECT RAISE(ABORT, 'Spec Impact results are append-only');
END;
CREATE TRIGGER spec_impact_results_immutable_delete
BEFORE DELETE ON spec_impact_results BEGIN
  SELECT RAISE(ABORT, 'Spec Impact results are append-only');
END;
