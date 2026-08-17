-- Revision-scoped contracts for modular L3 tasks. Runtime state continues to
-- live on the child tasks; these tables only describe an accepted plan.

CREATE TABLE lifecycle_acceptance_anchors (
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  anchor_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  disposition TEXT NOT NULL CHECK (disposition IN (
    'required', 'deferred', 'descope'
  )),
  reason TEXT,
  PRIMARY KEY (task_id, lifecycle_revision, anchor_id),
  CHECK (
    (disposition = 'required' AND reason IS NULL)
    OR (
      disposition <> 'required'
      AND reason IS NOT NULL
      AND length(trim(reason)) > 0
    )
  ),
  FOREIGN KEY (task_id, lifecycle_revision)
    REFERENCES lifecycle_revisions(task_id, revision)
);

CREATE TABLE lifecycle_execution_sources (
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('modules', 'single')),
  planning_revision INTEGER NOT NULL,
  source_plan_attempt_id TEXT NOT NULL,
  feasibility_review_attempt_id TEXT NOT NULL,
  PRIMARY KEY (task_id, lifecycle_revision),
  UNIQUE (source_plan_attempt_id),
  UNIQUE (feasibility_review_attempt_id),
  FOREIGN KEY (task_id, lifecycle_revision)
    REFERENCES lifecycle_revisions(task_id, revision),
  FOREIGN KEY (task_id, planning_revision)
    REFERENCES lifecycle_revisions(task_id, revision),
  FOREIGN KEY (source_plan_attempt_id, task_id)
    REFERENCES node_attempts(id, task_id),
  FOREIGN KEY (feasibility_review_attempt_id, task_id)
    REFERENCES node_attempts(id, task_id)
);

CREATE TABLE lifecycle_child_requirements (
  parent_task_id TEXT NOT NULL,
  parent_lifecycle_revision INTEGER NOT NULL,
  module_key TEXT NOT NULL CHECK (length(trim(module_key)) > 0),
  child_task_id TEXT NOT NULL,
  requirement_status TEXT NOT NULL CHECK (requirement_status IN (
    'required', 'not_required'
  )),
  order_index INTEGER NOT NULL CHECK (order_index >= 0),
  source_plan_attempt_id TEXT NOT NULL,
  PRIMARY KEY (parent_task_id, parent_lifecycle_revision, module_key),
  UNIQUE (parent_task_id, parent_lifecycle_revision, child_task_id),
  UNIQUE (parent_task_id, parent_lifecycle_revision, order_index),
  FOREIGN KEY (parent_task_id, parent_lifecycle_revision)
    REFERENCES lifecycle_revisions(task_id, revision),
  FOREIGN KEY (child_task_id) REFERENCES tasks(id),
  FOREIGN KEY (source_plan_attempt_id, parent_task_id)
    REFERENCES node_attempts(id, task_id)
);

CREATE TABLE lifecycle_anchor_coverage (
  parent_task_id TEXT NOT NULL,
  parent_lifecycle_revision INTEGER NOT NULL,
  anchor_id TEXT NOT NULL,
  child_task_id TEXT NOT NULL,
  PRIMARY KEY (
    parent_task_id, parent_lifecycle_revision, anchor_id, child_task_id
  ),
  FOREIGN KEY (parent_task_id, parent_lifecycle_revision, anchor_id)
    REFERENCES lifecycle_acceptance_anchors(
      task_id, lifecycle_revision, anchor_id
    ),
  FOREIGN KEY (parent_task_id, parent_lifecycle_revision, child_task_id)
    REFERENCES lifecycle_child_requirements(
      parent_task_id, parent_lifecycle_revision, child_task_id
    )
);

CREATE TABLE lifecycle_task_dependencies (
  parent_task_id TEXT NOT NULL,
  parent_lifecycle_revision INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  PRIMARY KEY (
    parent_task_id, parent_lifecycle_revision, task_id, depends_on_task_id
  ),
  CHECK (task_id <> depends_on_task_id),
  FOREIGN KEY (parent_task_id, parent_lifecycle_revision, task_id)
    REFERENCES lifecycle_child_requirements(
      parent_task_id, parent_lifecycle_revision, child_task_id
    ),
  FOREIGN KEY (parent_task_id, parent_lifecycle_revision, depends_on_task_id)
    REFERENCES lifecycle_child_requirements(
      parent_task_id, parent_lifecycle_revision, child_task_id
    )
);

CREATE TABLE lifecycle_validation_assignments (
  parent_task_id TEXT NOT NULL,
  parent_lifecycle_revision INTEGER NOT NULL,
  validation_id TEXT NOT NULL CHECK (length(trim(validation_id)) > 0),
  reference TEXT NOT NULL CHECK (length(trim(reference)) > 0),
  owner_kind TEXT NOT NULL CHECK (owner_kind IN (
    'child', 'parent_integrate'
  )),
  owner_child_task_id TEXT,
  PRIMARY KEY (
    parent_task_id, parent_lifecycle_revision, validation_id
  ),
  CHECK (
    (owner_kind = 'child' AND owner_child_task_id IS NOT NULL)
    OR (owner_kind = 'parent_integrate' AND owner_child_task_id IS NULL)
  ),
  FOREIGN KEY (
    parent_task_id, parent_lifecycle_revision, owner_child_task_id
  ) REFERENCES lifecycle_child_requirements(
    parent_task_id, parent_lifecycle_revision, child_task_id
  )
);

CREATE TABLE lifecycle_inherited_planning (
  child_task_id TEXT NOT NULL,
  child_lifecycle_revision INTEGER NOT NULL,
  parent_task_id TEXT NOT NULL,
  parent_lifecycle_revision INTEGER NOT NULL,
  module_key TEXT NOT NULL,
  source_plan_attempt_id TEXT NOT NULL,
  PRIMARY KEY (child_task_id, child_lifecycle_revision),
  UNIQUE (
    parent_task_id, parent_lifecycle_revision, module_key, child_task_id
  ),
  FOREIGN KEY (child_task_id, child_lifecycle_revision)
    REFERENCES lifecycle_revisions(task_id, revision),
  FOREIGN KEY (parent_task_id, parent_lifecycle_revision, module_key)
    REFERENCES lifecycle_child_requirements(
      parent_task_id, parent_lifecycle_revision, module_key
    ),
  FOREIGN KEY (source_plan_attempt_id, parent_task_id)
    REFERENCES node_attempts(id, task_id)
);

CREATE INDEX lifecycle_child_requirements_child_idx
  ON lifecycle_child_requirements(child_task_id);
CREATE INDEX lifecycle_task_dependencies_depends_on_idx
  ON lifecycle_task_dependencies(depends_on_task_id);

CREATE TRIGGER tasks_parent_depth_insert
BEFORE INSERT ON tasks
WHEN NEW.parent_task_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM tasks AS parent
  WHERE parent.id = NEW.parent_task_id
    AND parent.parent_task_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'task hierarchy is limited to one child level');
END;

CREATE TRIGGER tasks_parent_level_insert
BEFORE INSERT ON tasks
WHEN NEW.parent_task_id IS NOT NULL AND NEW.level = 3
BEGIN
  SELECT RAISE(ABORT, 'L3 tasks cannot be child tasks');
END;

CREATE TRIGGER lifecycle_execution_sources_kinds_insert
BEFORE INSERT ON lifecycle_execution_sources
WHEN NOT EXISTS (
  SELECT 1 FROM node_attempts AS attempt
  JOIN lifecycle_nodes AS node
    ON node.task_id = attempt.task_id
   AND node.lifecycle_revision = attempt.lifecycle_revision
   AND node.id = attempt.node_id
  WHERE attempt.id = NEW.source_plan_attempt_id
    AND attempt.task_id = NEW.task_id
    AND attempt.lifecycle_revision = NEW.planning_revision
    AND node.kind = 'plan'
) OR NOT EXISTS (
  SELECT 1 FROM review_links AS link
  JOIN node_attempts AS attempt
    ON attempt.id = link.review_attempt_id
   AND attempt.task_id = link.task_id
  WHERE link.review_attempt_id = NEW.feasibility_review_attempt_id
    AND link.task_id = NEW.task_id
    AND link.reviewed_attempt_id = NEW.source_plan_attempt_id
    AND link.review_purpose = 'feasibility'
    AND attempt.lifecycle_revision = NEW.planning_revision
)
BEGIN
  SELECT RAISE(ABORT, 'execution source must reference its accepted plan review');
END;

-- Accepted plan definitions are immutable. New plans create new revisions.
CREATE TRIGGER lifecycle_acceptance_anchors_immutable_update
BEFORE UPDATE ON lifecycle_acceptance_anchors BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_acceptance_anchors_immutable_delete
BEFORE DELETE ON lifecycle_acceptance_anchors BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_execution_sources_immutable_update
BEFORE UPDATE ON lifecycle_execution_sources BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_execution_sources_immutable_delete
BEFORE DELETE ON lifecycle_execution_sources BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_child_requirements_immutable_update
BEFORE UPDATE ON lifecycle_child_requirements BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_child_requirements_immutable_delete
BEFORE DELETE ON lifecycle_child_requirements BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_anchor_coverage_immutable_update
BEFORE UPDATE ON lifecycle_anchor_coverage BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_anchor_coverage_immutable_delete
BEFORE DELETE ON lifecycle_anchor_coverage BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_task_dependencies_immutable_update
BEFORE UPDATE ON lifecycle_task_dependencies BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_task_dependencies_immutable_delete
BEFORE DELETE ON lifecycle_task_dependencies BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_validation_assignments_immutable_update
BEFORE UPDATE ON lifecycle_validation_assignments BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_validation_assignments_immutable_delete
BEFORE DELETE ON lifecycle_validation_assignments BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_inherited_planning_immutable_update
BEFORE UPDATE ON lifecycle_inherited_planning BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
CREATE TRIGGER lifecycle_inherited_planning_immutable_delete
BEFORE DELETE ON lifecycle_inherited_planning BEGIN
  SELECT RAISE(ABORT, 'L3 plan definitions are immutable');
END;
