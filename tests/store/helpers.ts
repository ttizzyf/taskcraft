import { resolve } from "node:path";

import { expect } from "vitest";

import { TaskcraftError } from "../../src/core/errors.js";
import type { TaskcraftDatabase } from "../../src/store/database.js";
import { openDatabase } from "../../src/store/database.js";
import { applyMigrations } from "../../src/store/migrations.js";

const FIXED_TIMESTAMP = "2026-08-11T00:00:00.000Z";

export function createMigratedDatabase(): TaskcraftDatabase {
  const database = openDatabase(":memory:");
  applyMigrations(database, resolve("migrations"));
  return database;
}

export interface TaskFixtureOptions {
  id: string;
  title?: string;
  level?: 1 | 2 | 3;
  revision?: number;
  activatedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
}

// tasks and lifecycle_revisions reference each other (one FK deferred), so
// the pair must be inserted inside one transaction: tasks first (its FK to
// lifecycle_revisions defers the check), then lifecycle_revisions (its FK to
// tasks is immediate). When a transaction is already active the fixture joins
// it, so rollback tests observe the writes disappearing.
export function insertTask(
  database: TaskcraftDatabase,
  options: TaskFixtureOptions,
): void {
  const revision = options.revision ?? 1;

  runInOptionalTransaction(database, () => {
    database
      .prepare(
        `INSERT INTO tasks (
           id, title, level, objective_md, scope_json, acceptance_json,
           non_goals_json, classification_facts_json,
           classification_reasons_json, activated_at, cancelled_at,
           cancel_reason, current_lifecycle_revision, revision, created_at,
           updated_at
         ) VALUES (?, ?, ?, 'Objective', '{}', '[]', '[]', '{}', '[]',
           ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        options.id,
        options.title ?? "Test task",
        options.level ?? 1,
        options.activatedAt ?? null,
        options.cancelledAt ?? null,
        options.cancelReason ?? null,
        revision,
        revision,
        FIXED_TIMESTAMP,
        FIXED_TIMESTAMP,
      );

    database
      .prepare(
        `INSERT INTO lifecycle_revisions (
           task_id, revision, reason_code, reason, compiler_version,
           facts_digest, policy_digest, change_summary_json, created_by,
           created_at
         ) VALUES (?, ?, 'initial', 'initial revision', 'test-compiler',
           'facts-digest', 'policy-digest', '{}', 'tester', ?)`,
      )
      .run(options.id, revision, FIXED_TIMESTAMP);
  });
}

export function insertNode(
  database: TaskcraftDatabase,
  taskId: string,
  nodeId: string,
  kind: string,
): void {
  database
    .prepare(
      `INSERT INTO lifecycle_nodes (
         task_id, lifecycle_revision, id, kind, title, objective,
         procedure_ref, scope_json, entry_gate_json, exit_gate_json,
         retry_policy_json, input_schema_json, output_schema_json
       ) VALUES (?, 1, ?, ?, ?, 'Objective', 'procedure-ref',
         '{}', '{}', '{}', '{}', '{}', '{}')`,
    )
    .run(taskId, nodeId, kind, `${nodeId} title`);
}

export function insertAttempt(
  database: TaskcraftDatabase,
  taskId: string,
  attemptId: string,
): void {
  database
    .prepare(
      `INSERT INTO node_attempts (
         id, task_id, lifecycle_revision, node_id, attempt_number,
         actor_instance_id, host, status, outcome, result_json, started_at,
         finished_at
       ) VALUES (?, ?, 1, 'execute-1', 1, 'actor-1', 'host-1',
         'finished', 'success', '{}', ?, ?)`,
    )
    .run(attemptId, taskId, FIXED_TIMESTAMP, FIXED_TIMESTAMP);
}

/** Inserts a full L1-shaped task: lifecycle graph, attempts, evidence,
 * obligation results, an open blocker and one audit event. */
export function insertL1Fixture(database: TaskcraftDatabase): void {
  insertTask(database, { id: "task-l1", title: "L1 fixture task" });
  insertNode(database, "task-l1", "execute-1", "execute");
  insertNode(database, "task-l1", "record-1", "record");

  database
    .prepare(
      `INSERT INTO lifecycle_edges (
         task_id, lifecycle_revision, from_node_id, to_node_id,
         condition_json, label
       ) VALUES (?, 1, 'execute-1', 'record-1', '{"kind":"always"}', NULL)`,
    )
    .run("task-l1");

  insertObligation(
    database,
    "execute-1",
    "requested-outcome-produced",
    "required",
    "Requested outcome produced",
  );
  insertObligation(
    database,
    "execute-1",
    "minimum-validation-recorded",
    "required",
    "Minimum validation recorded",
  );
  insertObligation(
    database,
    "record-1",
    "result-and-scope-retained",
    "required",
    "Result and scope retained",
  );

  insertAttempt(database, "task-l1", "attempt-1");

  database
    .prepare(
      `INSERT INTO evidence (
         id, task_id, node_attempt_id, type, reference, summary, digest,
         created_by, created_at
       ) VALUES (?, ?, 'attempt-1', 'validation', 'ref://validation',
         'Validation evidence', NULL, 'actor-1', ?)`,
    )
    .run("evidence-1", "task-l1", FIXED_TIMESTAMP);

  database
    .prepare(
      `INSERT INTO obligation_results (
         task_id, lifecycle_revision, node_id, obligation_id, status,
         satisfied_by_evidence_id, skip_reason, updated_at
       ) VALUES (?, 1, 'execute-1', 'requested-outcome-produced',
         'satisfied', 'evidence-1', NULL, ?)`,
    )
    .run("task-l1", FIXED_TIMESTAMP);

  database
    .prepare(
      `INSERT INTO blockers (
         id, task_id, lifecycle_revision, node_id, kind, waiting_reason,
         status, reason, remediation_command, created_at, resolved_at
       ) VALUES (?, ?, 1, 'execute-1', 'evidence',
         'failed_retries_exhausted', 'open', 'Retries exhausted',
         'tc run task-l1', ?, NULL)`,
    )
    .run("blocker-1", "task-l1", FIXED_TIMESTAMP);

  database
    .prepare(
      `INSERT INTO events (
         event_id, task_id, task_seq, lifecycle_revision, node_id,
         attempt_id, actor_instance_id, host, event_type, payload_json,
         post_task_revision, occurred_at
       ) VALUES ('event-1', ?, 1, 1, 'execute-1', 'attempt-1',
         'actor-1', 'host-1', 'task_new', '{}', 1, ?)`,
    )
    .run("task-l1", FIXED_TIMESTAMP);
}

export function captureTaskcraftError(callback: () => unknown): TaskcraftError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(TaskcraftError);
    return error as TaskcraftError;
  }

  throw new Error("Expected the callback to throw a TaskcraftError");
}

/** Runs `fn` in a fresh transaction when none is active, otherwise joins the
 * active one (used so fixtures work both standalone and inside
 * withTransaction). */
function runInOptionalTransaction<T>(
  database: TaskcraftDatabase,
  fn: () => T,
): T {
  if (database.inTransaction) {
    return fn();
  }

  database.exec("BEGIN IMMEDIATE");

  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (cause) {
    if (database.inTransaction) {
      database.exec("ROLLBACK");
    }

    throw cause;
  }
}

function insertObligation(
  database: TaskcraftDatabase,
  nodeId: string,
  obligationId: string,
  duty: string,
  title: string,
): void {
  database
    .prepare(
      `INSERT INTO obligation_definitions (
         task_id, lifecycle_revision, node_id, id, duty, title,
         evaluator_json
       ) VALUES (?, 1, ?, ?, ?, ?, '{}')`,
    )
    .run("task-l1", nodeId, obligationId, duty, title);
}
