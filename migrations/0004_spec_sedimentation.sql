-- Post-completion Spec sedimentation facts.
--
-- A task that reached `done` may record which Spec documents its work touched.
-- The fact is append-only, creates no obligation and never changes the task's
-- projected status: sedimenting is an output of a finished task, not a step of
-- its completion contract.
--
-- The record deliberately stores no content digest and no evidence reference.
-- The Spec documents themselves are the artifact; a post-hoc note that carried
-- a version fingerprint would only be a burden on the writer, and re-checking a
-- recorded fact against today's Registry is a category error. Identity is the
-- natural key (task, revision, spec id list), so replaying the same list is a
-- no-op without deriving a content hash.

CREATE TABLE spec_sedimentation_results (
  task_id TEXT NOT NULL,
  lifecycle_revision INTEGER NOT NULL,
  spec_ids_json TEXT NOT NULL CHECK (length(trim(spec_ids_json)) > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_by TEXT NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (task_id, lifecycle_revision, spec_ids_json),
  FOREIGN KEY (task_id, lifecycle_revision)
    REFERENCES lifecycle_revisions(task_id, revision)
);

CREATE TRIGGER spec_sedimentation_results_immutable_update
BEFORE UPDATE ON spec_sedimentation_results BEGIN
  SELECT RAISE(ABORT, 'Spec sedimentation results are append-only');
END;
CREATE TRIGGER spec_sedimentation_results_immutable_delete
BEFORE DELETE ON spec_sedimentation_results BEGIN
  SELECT RAISE(ABORT, 'Spec sedimentation results are append-only');
END;
