-- Remove the two SHA-256 columns that were bound to the working-tree bytes.
--
-- `schema_migrations` is created by the runner itself (CREATE_LEDGER_SQL), not
-- by a numbered migration, so `DROP COLUMN` would fail on a fresh store where
-- the column was never created. Rebuilding the table instead is correct on both
-- paths: it renames whatever shape exists, copies the columns that survive, and
-- never names `checksum`.
ALTER TABLE schema_migrations RENAME TO schema_migrations_legacy;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

INSERT INTO schema_migrations (version, name, applied_at)
  SELECT version, name, applied_at FROM schema_migrations_legacy;

DROP TABLE schema_migrations_legacy;

-- `spec_digest` is a plain column (not in the primary key, any index or any
-- trigger), so it can be dropped in place. A binding records which rule
-- documents a task adopted, not what those documents said.
ALTER TABLE lifecycle_spec_bindings DROP COLUMN spec_digest;

-- Impacts recorded before this migration carry `updates[].digest` inside their
-- JSON blob. A stored Spec Impact is a historical fact, so the retired field is
-- removed once here rather than tolerated forever by the runtime schema. The
-- append-only trigger is restored verbatim afterwards.
DROP TRIGGER spec_impact_results_immutable_update;

UPDATE spec_impact_results
   SET details_json = json_object(
         'updates',
         (SELECT json_group_array(
                   json_object(
                     'specId', json_extract(item.value, '$.specId'),
                     'path', json_extract(item.value, '$.path'),
                     'evidenceRefs', json_extract(item.value, '$.evidenceRefs')))
            FROM json_each(spec_impact_results.details_json, '$.updates') AS item))
 WHERE outcome = 'updated';

CREATE TRIGGER spec_impact_results_immutable_update
BEFORE UPDATE ON spec_impact_results BEGIN
  SELECT RAISE(ABORT, 'Spec Impact results are append-only');
END;
